<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class MetaAdsApi extends BaseService
{
    private const DEFAULT_GRAPH_VERSION = 'v25.0';
    private const DEFAULT_SCOPES = 'public_profile,ads_read,business_management';

    public function fetchMetaAdsConnectionStatus(array $params = []): array
    {
        $this->requireAdmin();
        $connections = $this->database->fetchAll(
            'SELECT id, meta_user_id, meta_user_name, expires_at, is_active, last_synced_at, sync_error, created_at, updated_at
             FROM meta_ads_connections
             ORDER BY updated_at DESC'
        );

        return [
            'configured' => $this->hasOAuthConfig(),
            'redirectUri' => $this->configuredRedirectUri(),
            'connections' => array_map(fn(array $row): array => $this->mapConnection($row), $connections),
            'summary' => $this->buildSummary(),
        ];
    }

    public function fetchMetaAdsSettings(array $params = []): array
    {
        $this->requireAdmin();
        $row = $this->fetchMetaAdsSettingsRow();
        $config = $this->metaAppConfig();

        $adsCode = strtoupper(trim((string) ($row['display_currency_code'] ?? '')) ?: 'BDT');
        $resolvedRate = $this->resolveExchangeRate($adsCode, $row);

        return [
            'appId' => (string) ($row['app_id'] ?? $config['appId']),
            'appSecret' => (string) ($row['app_secret'] ?? $config['appSecret']),
            'redirectUri' => (string) ($row['redirect_uri'] ?? $config['redirectUri']),
            'loginConfigId' => (string) ($row['login_config_id'] ?? $config['loginConfigId']),
            'graphVersion' => (string) ($row['graph_version'] ?? $config['graphVersion']),
            'oauthScopes' => (string) ($row['oauth_scopes'] ?? $config['oauthScopes']),
            'displayCurrencyCode' => $adsCode,
            'displayCurrencyRateToBdt' => $row['display_currency_rate_to_bdt'] !== null ? (float) $row['display_currency_rate_to_bdt'] : null,
            'exchangeRateMode' => (string) ($row['exchange_rate_mode'] ?? 'fixed'),
            'vatPercentage' => $row['vat_percentage'] !== null ? (float) $row['vat_percentage'] : null,
            'realtimeRateCache' => $row['realtime_rate_cache'] !== null ? (float) $row['realtime_rate_cache'] : null,
            'realtimeRateUpdatedAt' => $this->toIso($row['realtime_rate_updated_at'] ?? null),
            'resolvedRateToBdt' => $resolvedRate,
        ];
    }

    public function updateMetaAdsSettings(array $params): array
    {
        $this->requireAdmin();
        $this->ensureMetaAdsSettingsTable();

        $mode = (string) ($params['exchangeRateMode'] ?? 'fixed');
        if (!in_array($mode, ['fixed', 'vat_based'], true)) {
            $mode = 'fixed';
        }

        $vatPct = $mode === 'vat_based' && $params['vatPercentage'] !== null && $params['vatPercentage'] !== ''
            ? (float) $params['vatPercentage']
            : null;

        $updates = [
            'app_id' => trim((string) ($params['appId'] ?? '')) !== '' ? trim((string) ($params['appId'] ?? '')) : null,
            'app_secret' => trim((string) ($params['appSecret'] ?? '')) !== '' ? trim((string) ($params['appSecret'] ?? '')) : null,
            'redirect_uri' => trim((string) ($params['redirectUri'] ?? '')) !== '' ? trim((string) ($params['redirectUri'] ?? '')) : null,
            'login_config_id' => trim((string) ($params['loginConfigId'] ?? '')) !== '' ? trim((string) ($params['loginConfigId'] ?? '')) : null,
            'graph_version' => trim((string) ($params['graphVersion'] ?? '')) !== '' ? trim((string) ($params['graphVersion'] ?? '')) : null,
            'oauth_scopes' => trim((string) ($params['oauthScopes'] ?? '')) !== '' ? trim((string) ($params['oauthScopes'] ?? '')) : null,
            'display_currency_code' => trim((string) ($params['displayCurrencyCode'] ?? '')) !== '' ? trim((string) ($params['displayCurrencyCode'] ?? '')) : 'BDT',
            'display_currency_rate_to_bdt' => $params['displayCurrencyRateToBdt'] !== null && $params['displayCurrencyRateToBdt'] !== '' ? (float) $params['displayCurrencyRateToBdt'] : null,
            'exchange_rate_mode' => $mode,
        ];

        $result = $this->saveSingleton('meta_ads_settings', 'meta-ads-default', $updates, fn(): array => $this->fetchMetaAdsSettings());

        // Explicitly set nullable fields that saveSingleton skips (it filters nulls)
        $row = $this->fetchMetaAdsSettingsRow();
        $existingId = (string) ($row['id'] ?? 'meta-ads-default');
        $this->database->execute(
            'UPDATE meta_ads_settings SET vat_percentage = :vat, updated_at = :now WHERE id = :id',
            [':vat' => $vatPct, ':now' => $this->database->nowUtc(), ':id' => $existingId]
        );

        return $this->fetchMetaAdsSettings();
    }

    public function beginMetaAdsOAuth(array $params = []): array
    {
        $user = $this->requireAdmin();
        if (!$this->hasOAuthConfig()) {
            throw new RuntimeException('Meta OAuth is not configured. Set the Meta app credentials in Settings.');
        }

        $state = bin2hex(random_bytes(24));
        $now = $this->database->nowUtc();
        $expiresAt = gmdate('Y-m-d H:i:s', time() + 900);
        $this->database->execute(
            'INSERT INTO meta_ads_oauth_states (id, user_id, redirect_after, created_at, expires_at)
             VALUES (:id, :user_id, :redirect_after, :created_at, :expires_at)',
            [
                ':id' => $state,
                ':user_id' => (string) $user['id'],
                ':redirect_after' => $this->nullableString($params['redirectAfter'] ?? null),
                ':created_at' => $now,
                ':expires_at' => $expiresAt,
            ]
        );

        $config = $this->metaAppConfig();
        $query = [
            'client_id' => $config['appId'],
            'redirect_uri' => $this->redirectUri(),
            'state' => $state,
            'scope' => $config['oauthScopes'],
            'response_type' => 'code',
        ];
        $configId = trim((string) $config['loginConfigId']);
        if ($configId !== '') {
            $query['config_id'] = $configId;
        }

        return [
            'authUrl' => $this->graphDialogBaseUrl() . '/dialog/oauth?' . http_build_query($query),
            'state' => $state,
        ];
    }

    public function handleOAuthCallback(array $params): array
    {
        $state = trim((string) ($params['state'] ?? ''));
        $code = trim((string) ($params['code'] ?? ''));
        if ($state === '' || $code === '') {
            return ['ok' => false, 'error' => 'Missing Meta OAuth state or code.'];
        }

        $stateRow = $this->database->fetchOne(
            'SELECT * FROM meta_ads_oauth_states
             WHERE id = :id AND used_at IS NULL AND expires_at >= :now
             LIMIT 1',
            [':id' => $state, ':now' => $this->database->nowUtc()]
        );
        if ($stateRow === null) {
            return ['ok' => false, 'error' => 'Meta OAuth session expired. Please try connecting again.'];
        }

        try {
            $token = $this->exchangeCodeForToken($code);
            $longToken = $this->exchangeForLongLivedToken((string) ($token['access_token'] ?? ''));
            if (!empty($longToken['access_token'])) {
                $token = array_merge($token, $longToken);
            }

            $accessToken = (string) ($token['access_token'] ?? '');
            if ($accessToken === '') {
                throw new RuntimeException('Meta did not return an access token.');
            }

            $profile = $this->graphGet('/me', $accessToken, ['fields' => 'id,name']);
            $connectionId = $this->upsertConnection((string) $stateRow['user_id'], $profile, $token);
            $this->database->execute(
                'UPDATE meta_ads_oauth_states SET used_at = :used_at WHERE id = :id',
                [':used_at' => $this->database->nowUtc(), ':id' => $state]
            );
            $sync = $this->syncConnection($connectionId);

            return [
                'ok' => true,
                'connectionId' => $connectionId,
                'synced' => $sync,
                'redirectAfter' => $this->nullableString($stateRow['redirect_after'] ?? null),
            ];
        } catch (\Throwable $exception) {
            return ['ok' => false, 'error' => $exception->getMessage()];
        }
    }

    public function syncMetaAds(array $params = []): array
    {
        $this->requireAdmin();
        $cooldown = $this->manualSyncCooldownRemaining();
        if ($cooldown > 0) {
            return [
                'ok' => false,
                'cooldownRemainingSeconds' => $cooldown,
                'error' => 'Please wait ' . $cooldown . ' seconds before syncing again.',
            ];
        }

        // Try to spawn sync as a background process so the HTTP response returns immediately.
        // This prevents the sync from blocking other API requests (orders, customers, etc.).
        if ($this->spawnBackgroundSync(true)) {
            return [
                'ok' => true,
                'started' => true,
                'message' => 'Sync started in background. Data will refresh automatically.',
            ];
        }

        // Fallback: synchronous sync (original behavior for environments without exec/popen)
        $startMs = (int) (microtime(true) * 1000);
        $result = $this->syncAllConnections();
        $durationMs = (int) (microtime(true) * 1000) - $startMs;
        $result['syncDurationMs'] = $durationMs;
        $this->saveSyncResultsToCache($result, true);
        return $result;
    }

    public function syncMetaAdsFromCli(): array
    {
        $result = $this->syncAllConnections();
        $this->saveSyncResultsToCache($result);
        return $result;
    }

    /**
     * CLI entry point for manual syncs (called with --manual flag).
     * Same as syncMetaAdsFromCli but also sets last_manual_sync_at and tracks duration.
     */
    public function syncMetaAdsFromCliManual(): array
    {
        $startMs = (int) (microtime(true) * 1000);
        $result = $this->syncAllConnections();
        $durationMs = (int) (microtime(true) * 1000) - $startMs;
        $result['syncDurationMs'] = $durationMs;
        $this->saveSyncResultsToCache($result, true);
        return $result;
    }

    public function fetchMetaAdsSyncCache(array $params = []): array
    {
        $this->currentUser();
        $cached = $this->getCachedSyncResults();
        if ($cached === null) {
            return [
                'ok' => false,
                'error' => 'No cached sync data available. Please run a sync first.',
                'lastSyncedAt' => null,
            ];
        }

        return [
            'ok' => true,
            'data' => $cached['data'],
            'lastSyncedAt' => $cached['lastSyncedAt'],
            'lastManualSyncAt' => $cached['lastManualSyncAt'] ?? null,
            'syncDurationMs' => $cached['syncDurationMs'] ?? null,
            'cooldownRemainingSeconds' => $this->manualSyncCooldownRemaining(),
        ];
    }

    public function fetchMetaAdsSyncStatus(array $params = []): array
    {
        $this->currentUser();
        $cached = $this->getCachedSyncResults();
        $cooldown = $this->manualSyncCooldownRemaining();
        return [
            'lastSyncedAt' => $cached['lastSyncedAt'] ?? null,
            'lastManualSyncAt' => $cached['lastManualSyncAt'] ?? null,
            'syncDurationMs' => $cached['syncDurationMs'] ?? null,
            'cooldownRemainingSeconds' => $cooldown,
        ];
    }

    public function fetchMetaAds(array $params = []): array
    {
        $this->currentUser();
        // Auto-sync stale data in background (non-blocking)
        $this->autoSyncIfNeeded();
        $businessId = trim((string) ($params['businessId'] ?? ''));
        $businessOperator = trim((string) ($params['businessOperator'] ?? '='));
        $accountId = trim((string) ($params['adAccountId'] ?? ''));
        $accountOperator = trim((string) ($params['adAccountOperator'] ?? '='));
        $campaignId = trim((string) ($params['campaignId'] ?? ''));
        $campaignOperator = trim((string) ($params['campaignOperator'] ?? '='));
        $status = trim((string) ($params['status'] ?? ''));
        $statusOperator = trim((string) ($params['statusOperator'] ?? '='));
        $from = $this->normalizeDateOnly((string) ($params['from'] ?? ''));
        $to = $this->normalizeDateOnly((string) ($params['to'] ?? ''));
        $search = trim((string) ($params['search'] ?? ''));
        $searchOperator = trim((string) ($params['searchOperator'] ?? 'contains'));

        $where = [];
        $bindings = [];
        if ($businessId !== '') {
            $operator = $businessOperator === '≠' ? '!=' : '=';
            $where[] = "ma.business_id {$operator} :business_id";
            $bindings[':business_id'] = $businessId;
        }
        if ($accountId !== '') {
            $operator = $accountOperator === '≠' ? '!=' : '=';
            $where[] = "ma.ad_account_id {$operator} :ad_account_id";
            $bindings[':ad_account_id'] = $accountId;
        }
        if ($campaignId !== '') {
            $operator = $campaignOperator === '≠' ? '!=' : '=';
            $where[] = "ma.campaign_id {$operator} :campaign_id";
            $bindings[':campaign_id'] = $campaignId;
        }
        if ($status !== '') {
            $operator = $statusOperator === '≠' ? '!=' : '=';
            $where[] = "COALESCE(ma.effective_status, ma.status, ma.configured_status, \"\") {$operator} :status";
            $bindings[':status'] = $status;
        }
        if ($from !== '') {
            $where[] = 'DATE(COALESCE(ma.updated_time, ma.last_synced_at, ma.updated_at)) >= :from_date';
            $bindings[':from_date'] = $from;
        }
        if ($to !== '') {
            $where[] = 'DATE(COALESCE(ma.updated_time, ma.last_synced_at, ma.updated_at)) <= :to_date';
            $bindings[':to_date'] = $to;
        }
        if ($search !== '') {
            if ($searchOperator === '≠') {
                $where[] = 'ma.name NOT LIKE :search';
            } elseif ($searchOperator === '=') {
                $where[] = 'ma.name = :search';
            } else {
                $where[] = 'ma.name LIKE :search';
            }
            $bindings[':search'] = $searchOperator === '=' ? $search : '%' . $search . '%';
        }

        $whereSql = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);
        $rows = $this->database->fetchAll(
            "SELECT ma.*, mb.name AS business_name, mb.meta_business_id,
                    maa.name AS ad_account_name, maa.meta_ad_account_id, maa.currency,
                    mc.name AS campaign_name, mc.meta_campaign_id
             FROM meta_ads ma
             LEFT JOIN meta_businesses mb ON mb.id = ma.business_id
             INNER JOIN meta_ad_accounts maa ON maa.id = ma.ad_account_id
             LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id
             {$whereSql}
             ORDER BY COALESCE(ma.updated_time, ma.last_synced_at, ma.updated_at) DESC, ma.name ASC
             LIMIT 500",
            $bindings
        );

        return [
            'ads' => array_map(fn(array $row): array => $this->mapAdCard($row), $rows),
            'summary' => $this->buildSummary($whereSql, $bindings),
            'filters' => $this->fetchMetaAdsFilters(),
        ];
    }

    public function fetchMetaAdById(array $params = []): ?array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT ma.*, mb.name AS business_name, mb.meta_business_id,
                    maa.name AS ad_account_name, maa.meta_ad_account_id, maa.currency,
                    mc.name AS campaign_name, mc.meta_campaign_id, mc.objective AS campaign_objective,
                    mas.name AS ad_set_name, mas.meta_ad_set_id, mas.daily_budget, mas.lifetime_budget
             FROM meta_ads ma
             LEFT JOIN meta_businesses mb ON mb.id = ma.business_id
             INNER JOIN meta_ad_accounts maa ON maa.id = ma.ad_account_id
             LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id
             LEFT JOIN meta_ad_sets mas ON mas.id = ma.ad_set_id
             WHERE ma.id = :id_local OR ma.meta_ad_id = :id_meta
             LIMIT 1',
            [':id_local' => $id, ':id_meta' => $id]
        );

        return $row === null ? null : $this->mapAdDetails($row);
    }

    public function fetchMetaAdsFilters(array $params = []): array
    {
        $this->currentUser();
        return [
            'businesses' => $this->database->fetchAll('SELECT id, meta_business_id AS metaBusinessId, name FROM meta_businesses ORDER BY name ASC'),
            'adAccounts' => $this->database->fetchAll('SELECT id, business_id AS businessId, meta_ad_account_id AS metaAdAccountId, name FROM meta_ad_accounts ORDER BY name ASC'),
            'campaigns' => $this->database->fetchAll('SELECT id, ad_account_id AS adAccountId, business_id AS businessId, meta_campaign_id AS metaCampaignId, name FROM meta_campaigns ORDER BY name ASC'),
            'statuses' => array_values(array_filter(array_map(
                static fn(array $row): string => (string) ($row['status'] ?? ''),
                $this->database->fetchAll('SELECT DISTINCT COALESCE(effective_status, status, configured_status) AS status FROM meta_ads ORDER BY status ASC')
            ))),
        ];
    }

    private function syncAllConnections(): array
    {
        $rows = $this->database->fetchAll('SELECT id FROM meta_ads_connections WHERE is_active = 1 ORDER BY updated_at DESC');
        $results = [];
        foreach ($rows as $row) {
            $results[] = $this->syncConnection((string) $row['id']);
        }
        return [
            'ok' => true,
            'connections' => count($rows),
            'results' => $results,
            'summary' => $this->buildSummary(),
        ];
    }

    private function syncConnection(string $connectionId): array
    {
        $connection = $this->database->fetchOne('SELECT * FROM meta_ads_connections WHERE id = :id LIMIT 1', [':id' => $connectionId]);
        if ($connection === null) {
            throw new RuntimeException('Meta connection not found.');
        }

        $accessToken = (string) ($connection['access_token'] ?? '');
        $counts = ['businesses' => 0, 'adAccounts' => 0, 'campaigns' => 0, 'adSets' => 0, 'ads' => 0];
        try {
            $businesses = $this->graphGetAll('/me/businesses', $accessToken, [
                'fields' => 'id,name,verification_status',
                'limit' => 100,
            ]);

            foreach ($businesses as $business) {
                $businessId = $this->upsertBusiness($connectionId, $business);
                $counts['businesses']++;
                $accounts = array_merge(
                    $this->graphGetAll('/' . $business['id'] . '/owned_ad_accounts', $accessToken, ['fields' => 'id,account_id,name,currency,account_status,timezone_name', 'limit' => 100]),
                    $this->graphGetAll('/' . $business['id'] . '/client_ad_accounts', $accessToken, ['fields' => 'id,account_id,name,currency,account_status,timezone_name', 'limit' => 100])
                );
                foreach ($this->dedupeById($accounts) as $account) {
                    $accountId = $this->upsertAdAccount($connectionId, $businessId, $account);
                    $counts['adAccounts']++;
                    $accountCounts = $this->syncAdAccount($accessToken, $accountId, $businessId, (string) $account['id']);
                    foreach ($accountCounts as $key => $value) {
                        $counts[$key] += $value;
                    }
                }
            }

            $fallbackAccounts = $this->graphGetAll('/me/adaccounts', $accessToken, [
                'fields' => 'id,account_id,name,currency,account_status,timezone_name,business{id,name,verification_status}',
                'limit' => 100,
            ]);
            foreach ($this->dedupeById($fallbackAccounts) as $account) {
                $businessId = null;
                if (is_array($account['business'] ?? null) && !empty($account['business']['id'])) {
                    $businessId = $this->upsertBusiness($connectionId, $account['business']);
                }
                $accountId = $this->upsertAdAccount($connectionId, $businessId, $account);
                $counts['adAccounts']++;
                $accountCounts = $this->syncAdAccount($accessToken, $accountId, $businessId, (string) $account['id']);
                foreach ($accountCounts as $key => $value) {
                    $counts[$key] += $value;
                }
            }

            $this->touchUpdate('meta_ads_connections', $connectionId, [
                'last_synced_at' => $this->database->nowUtc(),
                'sync_error' => null,
            ]);
        } catch (\Throwable $exception) {
            $this->touchUpdate('meta_ads_connections', $connectionId, [
                'sync_error' => $exception->getMessage(),
            ]);
            throw $exception;
        }

        return ['connectionId' => $connectionId, 'counts' => $counts];
    }

    private function syncAdAccount(string $accessToken, string $localAccountId, ?string $businessId, string $metaAccountId): array
    {
        $counts = ['campaigns' => 0, 'adSets' => 0, 'ads' => 0];
        $campaigns = $this->graphGetAll('/' . $metaAccountId . '/campaigns', $accessToken, [
            'fields' => 'id,name,objective,status,effective_status,buying_type,start_time,stop_time',
            'limit' => 100,
        ]);
        foreach ($campaigns as $campaign) {
            $this->upsertCampaign($localAccountId, $businessId, $campaign);
            $counts['campaigns']++;
        }

        $adSets = $this->graphGetAll('/' . $metaAccountId . '/adsets', $accessToken, [
            'fields' => 'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,campaign{id}',
            'limit' => 100,
        ]);
        foreach ($adSets as $adSet) {
            $this->upsertAdSet($localAccountId, $businessId, $adSet);
            $counts['adSets']++;
        }

        $ads = $this->graphGetAll('/' . $metaAccountId . '/ads', $accessToken, [
            'fields' => implode(',', [
                'id',
                'name',
                'status',
                'effective_status',
                'configured_status',
                'created_time',
                'updated_time',
                'campaign{id,name,objective}',
                'adset{id,name,start_time,end_time,daily_budget,lifetime_budget}',
                'creative{id,name,thumbnail_url,image_url,object_story_spec,asset_feed_spec,call_to_action_type}',
                'insights.date_preset(maximum){spend,reach,impressions,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas}',
            ]),
            'limit' => 100,
        ]);
        foreach ($ads as $ad) {
            $this->upsertAd($localAccountId, $businessId, $ad);
            $counts['ads']++;
        }

        try {
            $counts['dailyInsights'] = $this->syncAccountDailyInsights($accessToken, $localAccountId, $metaAccountId);
        } catch (\Throwable $e) {
            // Daily insights are best-effort; lifetime ad metrics still succeed.
            $counts['dailyInsights'] = 0;
            $counts['dailyInsightsError'] = $e->getMessage();
        }

        return $counts;
    }

    /**
     * Pull last-90d daily insights at ad level for an ad account and upsert into meta_ads_insights_daily.
     */
    private function syncAccountDailyInsights(string $accessToken, string $localAccountId, string $metaAccountId): int
    {
        $this->ensureMetaAdsInsightsDailyTable();
        $currencyRow = $this->database->fetchOne(
            'SELECT currency FROM meta_ad_accounts WHERE id = :id LIMIT 1',
            [':id' => $localAccountId]
        );
        $currency = $this->nullableString($currencyRow['currency'] ?? null);

        $localByMeta = [];
        $adRows = $this->database->fetchAll(
            'SELECT id, meta_ad_id FROM meta_ads WHERE ad_account_id = :account_id',
            [':account_id' => $localAccountId]
        );
        foreach ($adRows as $adRow) {
            $localByMeta[(string) $adRow['meta_ad_id']] = (string) $adRow['id'];
        }
        if ($localByMeta === []) {
            return 0;
        }

        $rows = $this->graphGetAll('/' . $metaAccountId . '/insights', $accessToken, [
            'fields' => 'ad_id,spend,impressions,reach,clicks,ctr,cpc,cpm,actions',
            'level' => 'ad',
            'time_increment' => 1,
            'date_preset' => 'last_90d',
            'limit' => 500,
        ]);

        $upserted = 0;
        $now = $this->database->nowUtc();
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $metaAdId = (string) ($row['ad_id'] ?? '');
            $insightDate = $this->normalizeDateOnly((string) ($row['date_start'] ?? ''));
            if ($metaAdId === '' || $insightDate === '' || !isset($localByMeta[$metaAdId])) {
                continue;
            }
            $localAdId = $localByMeta[$metaAdId];
            $actions = is_array($row['actions'] ?? null) ? $row['actions'] : [];
            $payload = [
                'ad_id' => $localAdId,
                'meta_ad_id' => $metaAdId,
                'insight_date' => $insightDate,
                'spend' => $this->formatMoney($row['spend'] ?? 0),
                'impressions' => (int) ($row['impressions'] ?? 0),
                'reach' => (int) ($row['reach'] ?? 0),
                'clicks' => (int) ($row['clicks'] ?? 0),
                'ctr' => isset($row['ctr']) ? (float) $row['ctr'] : null,
                'cpc' => isset($row['cpc']) ? (float) $row['cpc'] : null,
                'cpm' => isset($row['cpm']) ? (float) $row['cpm'] : null,
                'conversions' => $this->metricFromActions($actions, ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase', 'lead']),
                'currency' => $currency,
                'synced_at' => $now,
            ];
            $existing = $this->database->fetchOne(
                'SELECT id FROM meta_ads_insights_daily WHERE ad_id = :ad_id AND insight_date = :insight_date LIMIT 1',
                [':ad_id' => $localAdId, ':insight_date' => $insightDate]
            );
            if ($existing !== null) {
                $this->touchUpdate('meta_ads_insights_daily', (string) $existing['id'], $payload);
            } else {
                $payload['id'] = $this->uuid4();
                $payload['created_at'] = $now;
                $payload['updated_at'] = $now;
                $this->insertRow('meta_ads_insights_daily', $payload);
            }
            $upserted++;
        }
        return $upserted;
    }

    private function upsertConnection(string $userId, array $profile, array $token): string
    {
        $metaUserId = (string) ($profile['id'] ?? '');
        $existing = $metaUserId !== ''
            ? $this->database->fetchOne('SELECT id FROM meta_ads_connections WHERE user_id = :user_id AND meta_user_id = :meta_user_id LIMIT 1', [':user_id' => $userId, ':meta_user_id' => $metaUserId])
            : null;
        $id = (string) ($existing['id'] ?? $this->uuid4());
        $expiresAt = null;
        if (!empty($token['expires_in'])) {
            $expiresAt = gmdate('Y-m-d H:i:s', time() + (int) $token['expires_in']);
        }
        $payload = [
            'user_id' => $userId,
            'meta_user_id' => $metaUserId ?: null,
            'meta_user_name' => $this->nullableString($profile['name'] ?? null),
            'access_token' => (string) ($token['access_token'] ?? ''),
            'token_type' => $this->nullableString($token['token_type'] ?? null),
            'expires_at' => $expiresAt,
            'scopes' => $this->nullableString($token['scope'] ?? null),
            'is_active' => 1,
        ];

        if ($existing !== null) {
            $this->touchUpdate('meta_ads_connections', $id, $payload);
            return $id;
        }

        $payload['id'] = $id;
        $payload['created_at'] = $this->database->nowUtc();
        $payload['updated_at'] = $this->database->nowUtc();
        $this->insertRow('meta_ads_connections', $payload);
        return $id;
    }

    private function upsertBusiness(string $connectionId, array $business): string
    {
        $metaId = (string) ($business['id'] ?? '');
        if ($metaId === '') {
            throw new RuntimeException('Meta Business ID is missing.');
        }
        $existing = $this->database->fetchOne('SELECT id FROM meta_businesses WHERE meta_business_id = :meta_id LIMIT 1', [':meta_id' => $metaId]);
        $id = (string) ($existing['id'] ?? $this->uuid4());
        $payload = [
            'connection_id' => $connectionId,
            'meta_business_id' => $metaId,
            'name' => trim((string) ($business['name'] ?? 'Meta Business')),
            'verification_status' => $this->nullableString($business['verification_status'] ?? null),
            'raw_json' => $this->jsonEncode($business),
            'last_synced_at' => $this->database->nowUtc(),
        ];
        $this->upsertByExisting('meta_businesses', $id, $existing, $payload);
        return $id;
    }

    private function upsertAdAccount(string $connectionId, ?string $businessId, array $account): string
    {
        $metaId = $this->normalizeAdAccountNodeId((string) ($account['id'] ?? $account['account_id'] ?? ''));
        $accountId = (string) ($account['account_id'] ?? preg_replace('/^act_/', '', $metaId));
        if ($metaId === '') {
            throw new RuntimeException('Meta Ad Account ID is missing.');
        }
        $existing = $this->database->fetchOne('SELECT id FROM meta_ad_accounts WHERE meta_ad_account_id = :meta_id LIMIT 1', [':meta_id' => $metaId]);
        $id = (string) ($existing['id'] ?? $this->uuid4());
        $payload = [
            'connection_id' => $connectionId,
            'business_id' => $businessId,
            'meta_ad_account_id' => $metaId,
            'account_id' => $accountId,
            'name' => trim((string) ($account['name'] ?? $metaId)),
            'currency' => $this->nullableString($account['currency'] ?? null),
            'account_status' => $this->nullableString($account['account_status'] ?? null),
            'timezone_name' => $this->nullableString($account['timezone_name'] ?? null),
            'raw_json' => $this->jsonEncode($account),
            'last_synced_at' => $this->database->nowUtc(),
        ];
        $this->upsertByExisting('meta_ad_accounts', $id, $existing, $payload);
        return $id;
    }

    private function upsertCampaign(string $accountId, ?string $businessId, array $campaign): string
    {
        $metaId = (string) ($campaign['id'] ?? '');
        $existing = $this->database->fetchOne('SELECT id FROM meta_campaigns WHERE meta_campaign_id = :meta_id LIMIT 1', [':meta_id' => $metaId]);
        $id = (string) ($existing['id'] ?? $this->uuid4());
        $payload = [
            'ad_account_id' => $accountId,
            'business_id' => $businessId,
            'meta_campaign_id' => $metaId,
            'name' => trim((string) ($campaign['name'] ?? $metaId)),
            'objective' => $this->nullableString($campaign['objective'] ?? null),
            'status' => $this->nullableString($campaign['status'] ?? null),
            'effective_status' => $this->nullableString($campaign['effective_status'] ?? null),
            'buying_type' => $this->nullableString($campaign['buying_type'] ?? null),
            'start_time' => $this->metaDateTime($campaign['start_time'] ?? null),
            'stop_time' => $this->metaDateTime($campaign['stop_time'] ?? null),
            'raw_json' => $this->jsonEncode($campaign),
            'last_synced_at' => $this->database->nowUtc(),
        ];
        $this->upsertByExisting('meta_campaigns', $id, $existing, $payload);
        return $id;
    }

    private function upsertAdSet(string $accountId, ?string $businessId, array $adSet): string
    {
        $metaId = (string) ($adSet['id'] ?? '');
        $campaignLocalId = $this->localIdByMeta('meta_campaigns', 'meta_campaign_id', (string) ($adSet['campaign']['id'] ?? ''));
        $existing = $this->database->fetchOne('SELECT id FROM meta_ad_sets WHERE meta_ad_set_id = :meta_id LIMIT 1', [':meta_id' => $metaId]);
        $id = (string) ($existing['id'] ?? $this->uuid4());
        $payload = [
            'campaign_id' => $campaignLocalId,
            'ad_account_id' => $accountId,
            'business_id' => $businessId,
            'meta_ad_set_id' => $metaId,
            'name' => trim((string) ($adSet['name'] ?? $metaId)),
            'status' => $this->nullableString($adSet['status'] ?? null),
            'effective_status' => $this->nullableString($adSet['effective_status'] ?? null),
            'daily_budget' => $this->minorMoney($adSet['daily_budget'] ?? null),
            'lifetime_budget' => $this->minorMoney($adSet['lifetime_budget'] ?? null),
            'start_time' => $this->metaDateTime($adSet['start_time'] ?? null),
            'end_time' => $this->metaDateTime($adSet['end_time'] ?? null),
            'raw_json' => $this->jsonEncode($adSet),
            'last_synced_at' => $this->database->nowUtc(),
        ];
        $this->upsertByExisting('meta_ad_sets', $id, $existing, $payload);
        return $id;
    }

    private function upsertAd(string $accountId, ?string $businessId, array $ad): string
    {
        $metaId = (string) ($ad['id'] ?? '');
        $campaignMetaId = (string) ($ad['campaign']['id'] ?? '');
        if ($campaignMetaId !== '' && $this->localIdByMeta('meta_campaigns', 'meta_campaign_id', $campaignMetaId) === null) {
            $this->upsertCampaign($accountId, $businessId, $ad['campaign']);
        }
        $adSetMetaId = (string) ($ad['adset']['id'] ?? '');
        if ($adSetMetaId !== '' && $this->localIdByMeta('meta_ad_sets', 'meta_ad_set_id', $adSetMetaId) === null) {
            $this->upsertAdSet($accountId, $businessId, array_merge($ad['adset'], ['campaign' => ['id' => $campaignMetaId]]));
        }
        $campaignLocalId = $this->localIdByMeta('meta_campaigns', 'meta_campaign_id', $campaignMetaId);
        $adSetLocalId = $this->localIdByMeta('meta_ad_sets', 'meta_ad_set_id', $adSetMetaId);
        $creative = is_array($ad['creative'] ?? null) ? $ad['creative'] : [];
        $insight = is_array($ad['insights']['data'][0] ?? null) ? $ad['insights']['data'][0] : [];
        $text = $this->extractCreativeText($creative);
        $actions = is_array($insight['actions'] ?? null) ? $insight['actions'] : [];
        $roasRows = is_array($insight['purchase_roas'] ?? null) ? $insight['purchase_roas'] : [];
        $existing = $this->database->fetchOne('SELECT id FROM meta_ads WHERE meta_ad_id = :meta_id LIMIT 1', [':meta_id' => $metaId]);
        $id = (string) ($existing['id'] ?? $this->uuid4());
        $payload = [
            'ad_set_id' => $adSetLocalId,
            'campaign_id' => $campaignLocalId,
            'ad_account_id' => $accountId,
            'business_id' => $businessId,
            'meta_ad_id' => $metaId,
            'name' => trim((string) ($ad['name'] ?? $metaId)),
            'status' => $this->nullableString($ad['status'] ?? null),
            'effective_status' => $this->nullableString($ad['effective_status'] ?? null),
            'configured_status' => $this->nullableString($ad['configured_status'] ?? null),
            'objective' => $this->nullableString($ad['campaign']['objective'] ?? null),
            'creative_id' => $this->nullableString($creative['id'] ?? null),
            'thumbnail_url' => $this->nullableString($creative['thumbnail_url'] ?? null),
            'image_url' => $this->nullableString($creative['image_url'] ?? null),
            'video_url' => $this->nullableString($text['videoUrl'] ?? null),
            'primary_text' => $this->nullableString($text['primaryText'] ?? null),
            'headline' => $this->nullableString($text['headline'] ?? null),
            'description' => $this->nullableString($text['description'] ?? null),
            'call_to_action' => $this->nullableString($text['callToAction'] ?? ($creative['call_to_action_type'] ?? null)),
            'placements_json' => $this->jsonEncode($this->extractPlacements($creative)),
            'spend' => $this->formatMoney($insight['spend'] ?? 0),
            'reach' => (int) ($insight['reach'] ?? 0),
            'impressions' => (int) ($insight['impressions'] ?? 0),
            'clicks' => (int) ($insight['clicks'] ?? 0),
            'ctr' => (float) ($insight['ctr'] ?? 0),
            'cpc' => (float) ($insight['cpc'] ?? 0),
            'cpm' => (float) ($insight['cpm'] ?? 0),
            'conversions' => $this->metricFromActions($actions, ['offsite_conversion', 'purchase', 'lead']),
            'results' => $this->metricFromActions($actions, ['lead', 'purchase', 'link_click', 'onsite_conversion']),
            'roas' => $this->metricFromActions($roasRows, ['omni_purchase', 'purchase']),
            'metrics_json' => $this->jsonEncode($insight),
            'creative_json' => $this->jsonEncode($creative),
            'raw_json' => $this->jsonEncode($ad),
            'created_time' => $this->metaDateTime($ad['created_time'] ?? null),
            'updated_time' => $this->metaDateTime($ad['updated_time'] ?? null),
            'start_time' => $this->metaDateTime($ad['adset']['start_time'] ?? null),
            'end_time' => $this->metaDateTime($ad['adset']['end_time'] ?? null),
            'last_synced_at' => $this->database->nowUtc(),
        ];
        $this->upsertByExisting('meta_ads', $id, $existing, $payload);
        return $id;
    }

    private function upsertByExisting(string $table, string $id, ?array $existing, array $payload): void
    {
        if ($existing !== null) {
            $this->touchUpdate($table, $id, $payload);
            return;
        }
        $payload['id'] = $id;
        $payload['created_at'] = $this->database->nowUtc();
        $payload['updated_at'] = $this->database->nowUtc();
        $this->insertRow($table, $payload);
    }

    private function insertRow(string $table, array $payload): void
    {
        $columns = implode(', ', array_keys($payload));
        $placeholders = implode(', ', array_map(static fn(string $column): string => ':' . $column, array_keys($payload)));
        $bindings = [];
        foreach ($payload as $column => $value) {
            $bindings[':' . $column] = $value;
        }
        $this->database->execute("INSERT INTO {$table} ({$columns}) VALUES ({$placeholders})", $bindings);
    }

    private function graphGet(string $path, string $accessToken, array $query = []): array
    {
        if ($accessToken !== '') {
            $query['access_token'] = $accessToken;
        }
        $url = $this->graphBaseUrl() . $path . '?' . http_build_query($query);
        $response = $this->httpGetJson($url);
        if (isset($response['error'])) {
            $message = is_array($response['error']) ? (string) ($response['error']['message'] ?? 'Meta API error') : 'Meta API error';
            throw new RuntimeException($message);
        }
        return $response;
    }

    private function graphGetAll(string $path, string $accessToken, array $query = []): array
    {
        $query['limit'] = $query['limit'] ?? 100;
        $query['access_token'] = $accessToken;
        $url = $this->graphBaseUrl() . $path . '?' . http_build_query($query);
        $items = [];
        $guard = 0;
        while ($url !== '' && $guard < 25) {
            $response = $this->httpGetJson($url);
            if (isset($response['error'])) {
                $message = is_array($response['error']) ? (string) ($response['error']['message'] ?? 'Meta API error') : 'Meta API error';
                throw new RuntimeException($message);
            }
            foreach (($response['data'] ?? []) as $item) {
                if (is_array($item)) {
                    $items[] = $item;
                }
            }
            $url = (string) ($response['paging']['next'] ?? '');
            $guard++;
        }
        return $items;
    }

    private function httpGetJson(string $url): array
    {
        $context = stream_context_create(['http' => ['timeout' => 30, 'ignore_errors' => true]]);
        $raw = file_get_contents($url, false, $context);
        if ($raw === false) {
            throw new RuntimeException('Meta API request failed.');
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function exchangeCodeForToken(string $code): array
    {
        $config = $this->metaAppConfig();
        return $this->graphGet('/oauth/access_token', '', [
            'client_id' => $config['appId'],
            'client_secret' => $config['appSecret'],
            'redirect_uri' => $this->redirectUri(),
            'code' => $code,
        ]);
    }

    private function exchangeForLongLivedToken(string $shortToken): array
    {
        if ($shortToken === '') {
            return [];
        }
        $config = $this->metaAppConfig();
        return $this->graphGet('/oauth/access_token', '', [
            'grant_type' => 'fb_exchange_token',
            'client_id' => $config['appId'],
            'client_secret' => $config['appSecret'],
            'fb_exchange_token' => $shortToken,
        ]);
    }

    private function hasOAuthConfig(): bool
    {
        $config = $this->metaAppConfig();
        return trim((string) $config['appId']) !== '' && trim((string) $config['appSecret']) !== '';
    }

    private function configuredRedirectUri(): string
    {
        $config = $this->metaAppConfig();
        return trim((string) $config['redirectUri']);
    }

    private function redirectUri(): string
    {
        $configured = $this->configuredRedirectUri();
        if ($configured !== '') {
            return $configured;
        }

        $configured = trim((string) ($this->config->get('META_ADS_REDIRECT_URI', '') ?? ''));
        if ($configured !== '') {
            return $configured;
        }

        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $script = strtok($_SERVER['SCRIPT_NAME'] ?? '/api/index.php', '?') ?: '/api/index.php';
        return $scheme . '://' . $host . $script . '?action=metaAdsOAuthCallback';
    }

    private function frontendRedirectUrl(bool $ok, ?string $error = null): string
    {
        $base = trim((string) ($this->config->get('APP_FRONTEND_URL', '') ?? ''));
        if ($base === '') {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
            $base = $scheme . '://' . $host;
        }
        $hashQuery = http_build_query([
            'tab' => 'meta-ads',
            'meta_ads' => $ok ? 'connected' : 'error',
            'message' => $error ?? '',
        ]);
        return rtrim($base, '/') . '/#/settings?' . $hashQuery;
    }

    public function redirectAfterOAuth(array $params): void
    {
        $result = $this->handleOAuthCallback($params);
        $ok = !empty($result['ok']);
        $url = $this->frontendRedirectUrl($ok, $ok ? null : (string) ($result['error'] ?? 'Meta connection failed.'));
        header('Location: ' . $url, true, 302);
    }

    private function graphBaseUrl(): string
    {
        $config = $this->metaAppConfig();
        $version = trim((string) $config['graphVersion']);
        return 'https://graph.facebook.com/' . ($version !== '' ? $version : ($this->config->get('META_GRAPH_VERSION', self::DEFAULT_GRAPH_VERSION) ?? self::DEFAULT_GRAPH_VERSION));
    }

    private function graphDialogBaseUrl(): string
    {
        $config = $this->metaAppConfig();
        $version = trim((string) $config['graphVersion']);
        return 'https://www.facebook.com/' . ($version !== '' ? $version : ($this->config->get('META_GRAPH_VERSION', self::DEFAULT_GRAPH_VERSION) ?? self::DEFAULT_GRAPH_VERSION));
    }

    private function ensureMetaAdsSettingsTable(): void
    {
        if (!$this->tableExists('meta_ads_settings')) {
            $this->database->execute(
                'CREATE TABLE IF NOT EXISTS meta_ads_settings (
                    id VARCHAR(64) NOT NULL,
                    app_id VARCHAR(255) DEFAULT NULL,
                    app_secret VARCHAR(500) DEFAULT NULL,
                    redirect_uri VARCHAR(500) DEFAULT NULL,
                    login_config_id VARCHAR(255) DEFAULT NULL,
                    graph_version VARCHAR(64) DEFAULT NULL,
                    oauth_scopes VARCHAR(500) DEFAULT NULL,
                    display_currency_code VARCHAR(8) DEFAULT NULL,
                    display_currency_rate_to_bdt DECIMAL(14,4) DEFAULT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
        }
        if (!$this->columnExists('meta_ads_settings', 'display_currency_code')) {
            $this->database->execute("ALTER TABLE meta_ads_settings ADD COLUMN display_currency_code VARCHAR(8) DEFAULT 'BDT'");
        }
        if (!$this->columnExists('meta_ads_settings', 'display_currency_rate_to_bdt')) {
            $this->database->execute('ALTER TABLE meta_ads_settings ADD COLUMN display_currency_rate_to_bdt DECIMAL(14,4) DEFAULT NULL');
        }
        if (!$this->columnExists('meta_ads_settings', 'exchange_rate_mode')) {
            $this->database->execute("ALTER TABLE meta_ads_settings ADD COLUMN exchange_rate_mode VARCHAR(16) NOT NULL DEFAULT 'fixed'");
        }
        if (!$this->columnExists('meta_ads_settings', 'vat_percentage')) {
            $this->database->execute('ALTER TABLE meta_ads_settings ADD COLUMN vat_percentage DECIMAL(5,2) DEFAULT NULL');
        }
        if (!$this->columnExists('meta_ads_settings', 'realtime_rate_cache')) {
            $this->database->execute('ALTER TABLE meta_ads_settings ADD COLUMN realtime_rate_cache DECIMAL(14,4) DEFAULT NULL');
        }
        if (!$this->columnExists('meta_ads_settings', 'realtime_rate_updated_at')) {
            $this->database->execute('ALTER TABLE meta_ads_settings ADD COLUMN realtime_rate_updated_at DATETIME DEFAULT NULL');
        }
    }

    private function fetchMetaAdsSettingsRow(): array
    {
        $this->ensureMetaAdsSettingsTable();
        $row = $this->database->fetchOne('SELECT * FROM meta_ads_settings LIMIT 1');
        return is_array($row) ? $row : [];
    }

    /**
     * Resolve the effective exchange rate based on the configured mode.
     * - BDT: returns 1.0 (no conversion needed).
     * - fixed: returns the manually entered rate.
     * - vat_based: fetches real-time rate if cache is stale (>6h), applies VAT, returns result.
     */
    private function resolveExchangeRate(string $adsCode, array $settingsRow): ?float
    {
        if ($adsCode === 'BDT') {
            return 1.0;
        }

        $mode = (string) ($settingsRow['exchange_rate_mode'] ?? 'fixed');

        if ($mode === 'vat_based') {
            $vatPct = $settingsRow['vat_percentage'] !== null ? (float) $settingsRow['vat_percentage'] : null;
            if ($vatPct === null || $vatPct < 0) {
                // No VAT set — fall back to fixed rate
                return $settingsRow['display_currency_rate_to_bdt'] !== null
                    ? (float) $settingsRow['display_currency_rate_to_bdt']
                    : null;
            }

            $cachedRate = $settingsRow['realtime_rate_cache'] !== null ? (float) $settingsRow['realtime_rate_cache'] : null;
            $updatedAt = (string) ($settingsRow['realtime_rate_updated_at'] ?? '');
            $isFresh = false;
            if ($updatedAt !== '') {
                $cachedTime = strtotime($updatedAt);
                $isFresh = $cachedTime > 0 && (time() - $cachedTime) < 21600; // 6 hours
            }

            if (!$isFresh) {
                // Try to fetch a fresh real-time rate
                $fetched = $this->fetchRealTimeRate($adsCode);
                if ($fetched !== null) {
                    $cachedRate = $fetched;
                    $this->database->execute(
                        'UPDATE meta_ads_settings SET realtime_rate_cache = :rate, realtime_rate_updated_at = :now WHERE id = :id',
                        [':rate' => $cachedRate, ':now' => $this->database->nowUtc(), ':id' => ($settingsRow['id'] ?? 'meta-ads-default')]
                    );
                }
                // If fetch fails, keep using stale cache
            }

            if ($cachedRate !== null && $cachedRate > 0) {
                return round($cachedRate * (1 + $vatPct / 100), 4);
            }

            // No cache and API failed — fall back to fixed rate
            return $settingsRow['display_currency_rate_to_bdt'] !== null
                ? (float) $settingsRow['display_currency_rate_to_bdt']
                : null;
        }

        // Fixed mode
        return $settingsRow['display_currency_rate_to_bdt'] !== null
            ? (float) $settingsRow['display_currency_rate_to_bdt']
            : null;
    }

    /**
     * Fetch the real-time market exchange rate from {fromCurrency} to BDT.
     * Uses open.er-api.com (free, no key required).
     * Returns null on failure.
     */
    private function fetchRealTimeRate(string $fromCurrency): ?float
    {
        try {
            $url = 'https://open.er-api.com/v6/latest/' . urlencode($fromCurrency);
            $response = $this->httpGetJson($url);
            $rate = $response['rates']['BDT'] ?? null;
            if ($rate !== null && is_numeric($rate) && (float) $rate > 0) {
                return round((float) $rate, 4);
            }
        } catch (\Throwable) {
            // Silently fail — caller handles null
        }
        return null;
    }

    private function metaAppConfig(): array
    {
        $row = $this->fetchMetaAdsSettingsRow();
        return [
            'appId' => trim((string) ($row['app_id'] ?? '')) !== '' ? (string) $row['app_id'] : trim((string) ($this->config->get('META_APP_ID', '') ?? '')),
            'appSecret' => trim((string) ($row['app_secret'] ?? '')) !== '' ? (string) $row['app_secret'] : trim((string) ($this->config->get('META_APP_SECRET', '') ?? '')),
            'redirectUri' => trim((string) ($row['redirect_uri'] ?? '')) !== '' ? (string) $row['redirect_uri'] : trim((string) ($this->config->get('META_ADS_REDIRECT_URI', '') ?? '')),
            'loginConfigId' => trim((string) ($row['login_config_id'] ?? '')) !== '' ? (string) $row['login_config_id'] : trim((string) ($this->config->get('META_LOGIN_CONFIG_ID', '') ?? '')),
            'graphVersion' => trim((string) ($row['graph_version'] ?? '')) !== '' ? (string) $row['graph_version'] : trim((string) ($this->config->get('META_GRAPH_VERSION', self::DEFAULT_GRAPH_VERSION) ?? self::DEFAULT_GRAPH_VERSION)),
            'oauthScopes' => trim((string) ($row['oauth_scopes'] ?? '')) !== '' ? (string) $row['oauth_scopes'] : trim((string) ($this->config->get('META_ADS_OAUTH_SCOPES', self::DEFAULT_SCOPES) ?? self::DEFAULT_SCOPES)),
        ];
    }

    private function buildSummary(string $whereSql = '', array $bindings = []): array
    {
        $adWhere = $whereSql !== '' ? $whereSql : '';
        $adRow = $this->database->fetchOne(
            "SELECT COUNT(*) AS total_ads,
                    COALESCE(SUM(CASE WHEN COALESCE(effective_status, status) = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_ads,
                    COALESCE(SUM(CASE WHEN COALESCE(effective_status, status) <> 'ACTIVE' THEN 1 ELSE 0 END), 0) AS inactive_ads,
                    COALESCE(SUM(spend), 0) AS total_spend,
                    COALESCE(SUM(impressions), 0) AS total_impressions,
                    COALESCE(SUM(clicks), 0) AS total_clicks
             FROM meta_ads ma {$adWhere}",
            $bindings
        ) ?? [];
        return [
            'totalBusinesses' => (int) (($this->database->fetchOne('SELECT COUNT(*) AS count FROM meta_businesses')['count'] ?? 0)),
            'totalAdAccounts' => (int) (($this->database->fetchOne('SELECT COUNT(*) AS count FROM meta_ad_accounts')['count'] ?? 0)),
            'totalCampaigns' => (int) (($this->database->fetchOne('SELECT COUNT(*) AS count FROM meta_campaigns')['count'] ?? 0)),
            'totalAds' => (int) ($adRow['total_ads'] ?? 0),
            'activeAds' => (int) ($adRow['active_ads'] ?? 0),
            'inactiveAds' => (int) ($adRow['inactive_ads'] ?? 0),
            'totalSpend' => (float) ($adRow['total_spend'] ?? 0),
            'todaySpend' => (float) (($this->database->fetchOne("SELECT COALESCE(SUM(spend), 0) AS s FROM meta_ads ma $adWhere " . ($adWhere !== '' ? 'AND' : 'WHERE') . " DATE(COALESCE(updated_time, last_synced_at, updated_at)) = :today", array_merge($bindings, [':today' => gmdate('Y-m-d')]))['s'] ?? 0)),
            'activeCampaigns' => (int) (($this->database->fetchOne("SELECT COUNT(*) AS c FROM meta_campaigns WHERE COALESCE(effective_status, status) = 'ACTIVE'")['c'] ?? 0)),
            'activeAdSets' => (int) (($this->database->fetchOne("SELECT COUNT(*) AS c FROM meta_ad_sets WHERE COALESCE(effective_status, status) = 'ACTIVE'")['c'] ?? 0)),
            // Prefer average Meta purchase_roas from ad rows; never use clicks/spend.
            'currentRoas' => $this->averageStoredAdRoas($adWhere, $bindings),
        ];
    }

    private function averageStoredAdRoas(string $whereSql, array $bindings): ?float
    {
        $row = $this->database->fetchOne(
            "SELECT AVG(roas) AS avg_roas, COUNT(*) AS cnt
             FROM meta_ads ma
             {$whereSql}
             " . ($whereSql !== '' ? 'AND' : 'WHERE') . ' roas IS NOT NULL AND roas > 0',
            $bindings
        );
        if ($row === null || (int) ($row['cnt'] ?? 0) === 0) {
            return null;
        }
        return round((float) ($row['avg_roas'] ?? 0), 2);
    }

    private function mapConnection(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'metaUserId' => $this->nullableString($row['meta_user_id'] ?? null),
            'metaUserName' => $this->nullableString($row['meta_user_name'] ?? null),
            'expiresAt' => $this->toIso($row['expires_at'] ?? null),
            'isActive' => !empty($row['is_active']),
            'lastSyncedAt' => $this->toIso($row['last_synced_at'] ?? null),
            'syncError' => $this->nullableString($row['sync_error'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    private function mapAdCard(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'metaAdId' => (string) $row['meta_ad_id'],
            'name' => (string) ($row['name'] ?? ''),
            'campaignName' => (string) ($row['campaign_name'] ?? ''),
            'campaignId' => $this->nullableString($row['meta_campaign_id'] ?? null),
            'adAccountName' => (string) ($row['ad_account_name'] ?? ''),
            'businessName' => (string) ($row['business_name'] ?? 'Unassigned Business'),
            'status' => $this->displayStatus($row),
            'spend' => (float) ($row['spend'] ?? 0),
            'reach' => (int) ($row['reach'] ?? 0),
            'impressions' => (int) ($row['impressions'] ?? 0),
            'clicks' => (int) ($row['clicks'] ?? 0),
            'ctr' => (float) ($row['ctr'] ?? 0),
            'cpc' => (float) ($row['cpc'] ?? 0),
            'cpm' => (float) ($row['cpm'] ?? 0),
            'conversions' => $row['conversions'] === null ? null : (float) $row['conversions'],
            'results' => $row['results'] === null ? null : (float) $row['results'],
            'roas' => $row['roas'] === null ? null : (float) $row['roas'],
            'createdAt' => $this->toIso($row['created_time'] ?? null),
            'lastUpdatedAt' => $this->toIso($row['updated_time'] ?? $row['last_synced_at'] ?? $row['updated_at'] ?? null),
            'thumbnailUrl' => $this->nullableString($row['thumbnail_url'] ?? null),
            'adAccountCurrency' => $this->nullableString($row['currency'] ?? null),
        ];
    }

    private function mapAdDetails(array $row): array
    {
        return array_merge($this->mapAdCard($row), [
            'campaignId' => $this->nullableString($row['meta_campaign_id'] ?? null),
            'adSetName' => $this->nullableString($row['ad_set_name'] ?? null),
            'adSetId' => $this->nullableString($row['meta_ad_set_id'] ?? null),
            'adAccountId' => (string) ($row['meta_ad_account_id'] ?? ''),
            'businessId' => $this->nullableString($row['meta_business_id'] ?? null),
            'objective' => $this->nullableString($row['objective'] ?? $row['campaign_objective'] ?? null),
            'budget' => [
                'dailyBudget' => $row['daily_budget'] === null ? null : (float) $row['daily_budget'],
                'lifetimeBudget' => $row['lifetime_budget'] === null ? null : (float) $row['lifetime_budget'],
            ],
            'metrics' => [
                'spend' => (float) ($row['spend'] ?? 0),
                'reach' => (int) ($row['reach'] ?? 0),
                'impressions' => (int) ($row['impressions'] ?? 0),
                'clicks' => (int) ($row['clicks'] ?? 0),
                'ctr' => (float) ($row['ctr'] ?? 0),
                'cpc' => (float) ($row['cpc'] ?? 0),
                'cpm' => (float) ($row['cpm'] ?? 0),
                'conversions' => $row['conversions'] === null ? null : (float) $row['conversions'],
                'results' => $row['results'] === null ? null : (float) $row['results'],
                'roas' => $row['roas'] === null ? null : (float) $row['roas'],
                'raw' => $this->jsonDecodeAssoc($row['metrics_json'] ?? null),
            ],
            'creative' => [
                'thumbnailUrl' => $this->nullableString($row['thumbnail_url'] ?? null),
                'imageUrl' => $this->nullableString($row['image_url'] ?? null),
                'videoUrl' => $this->nullableString($row['video_url'] ?? null),
                'primaryText' => $this->nullableString($row['primary_text'] ?? null),
                'headline' => $this->nullableString($row['headline'] ?? null),
                'description' => $this->nullableString($row['description'] ?? null),
                'callToAction' => $this->nullableString($row['call_to_action'] ?? null),
                'raw' => $this->jsonDecodeAssoc($row['creative_json'] ?? null),
            ],
            'placements' => $this->jsonDecodeAssoc($row['placements_json'] ?? null),
            'createdAt' => $this->toIso($row['created_time'] ?? null),
            'updatedAt' => $this->toIso($row['updated_time'] ?? null),
            'startAt' => $this->toIso($row['start_time'] ?? null),
            'endAt' => $this->toIso($row['end_time'] ?? null),
            'lastSyncedAt' => $this->toIso($row['last_synced_at'] ?? null),
            'raw' => $this->jsonDecodeAssoc($row['raw_json'] ?? null),
        ]);
    }

    private function displayStatus(array $row): string
    {
        $raw = trim((string) ($row['effective_status'] ?? $row['status'] ?? $row['configured_status'] ?? 'UNKNOWN'));
        return $raw === '' ? 'UNKNOWN' : strtoupper($raw);
    }

    private function normalizeAdAccountNodeId(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }
        return str_starts_with($trimmed, 'act_') ? $trimmed : 'act_' . $trimmed;
    }

    private function localIdByMeta(string $table, string $column, string $metaId): ?string
    {
        $metaId = trim($metaId);
        if ($metaId === '') {
            return null;
        }
        $row = $this->database->fetchOne("SELECT id FROM {$table} WHERE {$column} = :meta_id LIMIT 1", [':meta_id' => $metaId]);
        return $row === null ? null : (string) $row['id'];
    }

    private function metaDateTime($value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }
        $date = $this->parseDateTimeValue($trimmed, $this->utcTimezone());
        return $date instanceof \DateTimeImmutable ? $date->setTimezone($this->utcTimezone())->format('Y-m-d H:i:s') : null;
    }

    private function minorMoney($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        return round(((float) $value) / 100, 2);
    }

    private function metricFromActions(array $rows, array $needles): ?float
    {
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $type = strtolower((string) ($row['action_type'] ?? ''));
            foreach ($needles as $needle) {
                if ($type !== '' && str_contains($type, strtolower($needle))) {
                    return (float) ($row['value'] ?? 0);
                }
            }
        }
        return null;
    }

    private function extractCreativeText(array $creative): array
    {
        $story = is_array($creative['object_story_spec'] ?? null) ? $creative['object_story_spec'] : [];
        $link = is_array($story['link_data'] ?? null) ? $story['link_data'] : [];
        $video = is_array($story['video_data'] ?? null) ? $story['video_data'] : [];
        $cta = $link['call_to_action'] ?? $video['call_to_action'] ?? [];
        return [
            'primaryText' => $link['message'] ?? $video['message'] ?? $story['message'] ?? null,
            'headline' => $link['name'] ?? $video['title'] ?? null,
            'description' => $link['description'] ?? $video['link_description'] ?? null,
            'callToAction' => is_array($cta) ? ($cta['type'] ?? null) : null,
            'videoUrl' => $video['video_id'] ?? null,
        ];
    }

    private function extractPlacements(array $creative): array
    {
        $assetFeed = is_array($creative['asset_feed_spec'] ?? null) ? $creative['asset_feed_spec'] : [];
        return [
            'publisherPlatforms' => $assetFeed['ad_formats'] ?? [],
            'assetCustomizationRules' => $assetFeed['asset_customization_rules'] ?? [],
        ];
    }

    private function dedupeById(array $items): array
    {
        $seen = [];
        $result = [];
        foreach ($items as $item) {
            $id = (string) ($item['id'] ?? '');
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $result[] = $item;
        }
        return $result;
    }

    private function ensureMetaAdsSyncCacheTable(): void
    {
        $this->database->execute(
            'CREATE TABLE IF NOT EXISTS meta_ads_sync_cache (
                id VARCHAR(36) PRIMARY KEY,
                sync_data LONGTEXT,
                last_synced_at DATETIME,
                last_manual_sync_at DATETIME DEFAULT NULL,
                sync_duration_ms INT,
                error_message LONGTEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        if (!$this->columnExists('meta_ads_sync_cache', 'last_manual_sync_at')) {
            $this->database->execute('ALTER TABLE meta_ads_sync_cache ADD COLUMN last_manual_sync_at DATETIME DEFAULT NULL');
        }
    }

    private function saveSyncResultsToCache(array $syncResult, bool $isManual = false): void
    {
        $this->ensureMetaAdsSyncCacheTable();
        
        $id = 'meta-ads-sync-default';
        $syncData = json_encode($syncResult);
        $now = $this->database->nowUtc();
        $duration = isset($syncResult['syncDurationMs']) ? (int) $syncResult['syncDurationMs'] : null;
        
        $existing = $this->database->fetchOne('SELECT id FROM meta_ads_sync_cache WHERE id = :id LIMIT 1', [':id' => $id]);
        
        if ($existing !== null) {
            $bindings = [
                ':id' => $id,
                ':data' => $syncData,
                ':now_synced' => $now,
                ':now_updated' => $now,
                ':duration' => $duration,
            ];
            $sql = 'UPDATE meta_ads_sync_cache SET sync_data = :data, last_synced_at = :now_synced, sync_duration_ms = :duration, error_message = NULL, updated_at = :now_updated';
            if ($isManual) {
                $sql .= ', last_manual_sync_at = :manual_sync_at';
                $bindings[':manual_sync_at'] = $now;
            }
            $sql .= ' WHERE id = :id';
            $this->database->execute($sql, $bindings);
        } else {
            $this->database->execute(
                'INSERT INTO meta_ads_sync_cache (id, sync_data, last_synced_at, last_manual_sync_at, sync_duration_ms, created_at, updated_at) VALUES (:id, :data, :now_synced, :manual_sync_at, :duration, :now_created, :now_updated)',
                [
                    ':id' => $id,
                    ':data' => $syncData,
                    ':now_synced' => $now,
                    ':manual_sync_at' => $isManual ? $now : null,
                    ':duration' => $duration,
                    ':now_created' => $now,
                    ':now_updated' => $now,
                ]);
        }
    }

    private function getCachedSyncResults(): ?array
    {
        $this->ensureMetaAdsSyncCacheTable();
        
        $row = $this->database->fetchOne('SELECT sync_data, last_synced_at, last_manual_sync_at, sync_duration_ms FROM meta_ads_sync_cache WHERE id = :id LIMIT 1', [':id' => 'meta-ads-sync-default']);
        if ($row === null) {
            return null;
        }

        $syncData = json_decode((string) ($row['sync_data'] ?? '{}'), true);
        return [
            'data' => is_array($syncData) ? $syncData : [],
            'lastSyncedAt' => $row['last_synced_at'],
            'lastManualSyncAt' => $row['last_manual_sync_at'] ?? null,
            'syncDurationMs' => (int) ($row['sync_duration_ms'] ?? 0),
        ];
    }

    private function manualSyncCooldownRemaining(): int
    {
        $this->ensureMetaAdsSyncCacheTable();
        $row = $this->database->fetchOne(
            'SELECT last_manual_sync_at FROM meta_ads_sync_cache WHERE id = :id LIMIT 1',
            [':id' => 'meta-ads-sync-default']
        );
        $lastManual = trim((string) (($row['last_manual_sync_at'] ?? '')));
        if ($lastManual === '') {
            return 0;
        }
        $lastTs = strtotime($lastManual);
        if ($lastTs === false) {
            return 0;
        }
        $elapsed = time() - $lastTs;
        $cooldownSeconds = 120;
        return $elapsed < $cooldownSeconds ? $cooldownSeconds - $elapsed : 0;
    }

    private function ensureMetaAdsInsightsCacheTable(): void
    {
        $this->database->execute(
            'CREATE TABLE IF NOT EXISTS meta_ads_insights_cache (
                id VARCHAR(36) PRIMARY KEY,
                ad_id VARCHAR(64) NOT NULL,
                category VARCHAR(32) NOT NULL,
                data_json LONGTEXT,
                last_synced_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_insights_ad_category (ad_id, category)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    private function getActiveMetaAccessToken(): string
    {
        $row = $this->database->fetchOne('SELECT access_token FROM meta_ads_connections WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1');
        if ($row === null || empty($row['access_token'])) {
            throw new RuntimeException('No active Meta Ads connection found.');
        }
        return (string) $row['access_token'];
    }

    private function getCachedInsights(string $adId, string $category, int $ttlHours = 6): ?array
    {
        $this->ensureMetaAdsInsightsCacheTable();
        $row = $this->database->fetchOne('SELECT data_json, last_synced_at FROM meta_ads_insights_cache WHERE ad_id = :ad_id AND category = :category LIMIT 1', [':ad_id' => $adId, ':category' => $category]);
        if ($row === null) return null;
        $lastSynced = $row['last_synced_at'] ? strtotime((string) $row['last_synced_at']) : 0;
        if ($lastSynced > 0 && (time() - $lastSynced) < ($ttlHours * 3600)) {
            $decoded = json_decode((string) ($row['data_json'] ?? '{}'), true);
            return is_array($decoded) ? $decoded : null;
        }
        return null;
    }

    private function saveInsightsCache(string $adId, string $category, array $data): void
    {
        $this->ensureMetaAdsInsightsCacheTable();
        $now = $this->database->nowUtc();
        $dataJson = json_encode($data);
        $existing = $this->database->fetchOne('SELECT id FROM meta_ads_insights_cache WHERE ad_id = :ad_id AND category = :category LIMIT 1', [':ad_id' => $adId, ':category' => $category]);
        if ($existing !== null) {
            $this->database->execute('UPDATE meta_ads_insights_cache SET data_json = :data, last_synced_at = :now, updated_at = :now WHERE ad_id = :ad_id AND category = :category', [':data' => $dataJson, ':now' => $now, ':ad_id' => $adId, ':category' => $category]);
        } else {
            $this->database->execute('INSERT INTO meta_ads_insights_cache (id, ad_id, category, data_json, last_synced_at, created_at, updated_at) VALUES (:id, :ad_id, :category, :data, :now, :now, :now)', [':id' => $this->uuid4(), ':ad_id' => $adId, ':category' => $category, ':data' => $dataJson, ':now' => $now]);
        }
    }

    private function resolveAdMetaId(string $id): ?array
    {
        return $this->database->fetchOne('SELECT ma.meta_ad_id, maa.currency FROM meta_ads ma INNER JOIN meta_ad_accounts maa ON maa.id = ma.ad_account_id WHERE ma.id = :id_local OR ma.meta_ad_id = :id_meta LIMIT 1', [':id_local' => $id, ':id_meta' => $id]);
    }

    public function fetchMetaAdInsightsDaily(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') return ['data' => []];
        $adRow = $this->resolveAdMetaId($id);
        if ($adRow === null) return ['data' => []];
        $metaAdId = (string) $adRow['meta_ad_id'];
        $currency = $this->nullableString($adRow['currency'] ?? null);
        $cached = $this->getCachedInsights($id, 'daily');
        if ($cached !== null) return ['data' => $cached, 'currency' => $currency];
        try {
            $accessToken = $this->getActiveMetaAccessToken();
            $rows = $this->graphGetAll('/' . $metaAdId . '/insights', $accessToken, [
                'fields' => 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas',
                'time_increment' => 1, 'date_preset' => 'last_90d', 'limit' => 100,
            ]);
            $data = array_map(function(array $r) {
                return [
                    'date' => $r['date_start'] ?? '', 'spend' => (float) ($r['spend'] ?? 0),
                    'impressions' => (int) ($r['impressions'] ?? 0), 'reach' => (int) ($r['reach'] ?? 0),
                    'clicks' => (int) ($r['clicks'] ?? 0), 'ctr' => (float) ($r['ctr'] ?? 0),
                    'cpc' => (float) ($r['cpc'] ?? 0), 'cpm' => (float) ($r['cpm'] ?? 0),
                    'conversions' => $this->metricFromActions($r['actions'] ?? [], ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']),
                    'roas' => !empty($r['purchase_roas']) ? (float) ($r['purchase_roas'][0]['value'] ?? 0) : null,
                ];
            }, $rows);
            $this->saveInsightsCache($id, 'daily', $data);
            return ['data' => $data, 'currency' => $currency];
        } catch (\Throwable $e) {
            return ['data' => [], 'error' => $e->getMessage(), 'currency' => $currency];
        }
    }

    public function fetchMetaAdInsightsDemographics(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') return ['data' => []];
        $adRow = $this->resolveAdMetaId($id);
        if ($adRow === null) return ['data' => []];
        $metaAdId = (string) $adRow['meta_ad_id'];
        $currency = $this->nullableString($adRow['currency'] ?? null);
        $cached = $this->getCachedInsights($id, 'demographics');
        if ($cached !== null) return ['data' => $cached, 'currency' => $currency];
        try {
            $accessToken = $this->getActiveMetaAccessToken();
            $rows = $this->graphGetAll('/' . $metaAdId . '/insights', $accessToken, [
                'fields' => 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions',
                'breakdowns' => 'age,gender', 'date_preset' => 'maximum', 'limit' => 200,
            ]);
            $data = array_map(function(array $r) {
                return [
                    'age' => $r['age'] ?? '', 'gender' => $r['gender'] ?? '',
                    'spend' => (float) ($r['spend'] ?? 0), 'impressions' => (int) ($r['impressions'] ?? 0),
                    'reach' => (int) ($r['reach'] ?? 0), 'clicks' => (int) ($r['clicks'] ?? 0),
                    'ctr' => (float) ($r['ctr'] ?? 0), 'cpc' => (float) ($r['cpc'] ?? 0), 'cpm' => (float) ($r['cpm'] ?? 0),
                    'conversions' => $this->metricFromActions($r['actions'] ?? [], ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']),
                ];
            }, $rows);
            $this->saveInsightsCache($id, 'demographics', $data);
            return ['data' => $data, 'currency' => $currency];
        } catch (\Throwable $e) {
            return ['data' => [], 'error' => $e->getMessage(), 'currency' => $currency];
        }
    }

    public function fetchMetaAdInsightsPlacements(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') return ['data' => []];
        $adRow = $this->resolveAdMetaId($id);
        if ($adRow === null) return ['data' => []];
        $metaAdId = (string) $adRow['meta_ad_id'];
        $currency = $this->nullableString($adRow['currency'] ?? null);
        $cached = $this->getCachedInsights($id, 'placements');
        if ($cached !== null) return ['data' => $cached, 'currency' => $currency];
        try {
            $accessToken = $this->getActiveMetaAccessToken();
            $rows = $this->graphGetAll('/' . $metaAdId . '/insights', $accessToken, [
                'fields' => 'spend,impressions,reach,clicks,ctr,cpc,cpm',
                'breakdowns' => 'publisher_platform,platform_position', 'date_preset' => 'maximum', 'limit' => 200,
            ]);
            $data = array_map(function(array $r) {
                return [
                    'platform' => $r['publisher_platform'] ?? '', 'position' => $r['platform_position'] ?? '',
                    'spend' => (float) ($r['spend'] ?? 0), 'impressions' => (int) ($r['impressions'] ?? 0),
                    'reach' => (int) ($r['reach'] ?? 0), 'clicks' => (int) ($r['clicks'] ?? 0),
                    'ctr' => (float) ($r['ctr'] ?? 0), 'cpc' => (float) ($r['cpc'] ?? 0), 'cpm' => (float) ($r['cpm'] ?? 0),
                ];
            }, $rows);
            $this->saveInsightsCache($id, 'placements', $data);
            return ['data' => $data, 'currency' => $currency];
        } catch (\Throwable $e) {
            return ['data' => [], 'error' => $e->getMessage(), 'currency' => $currency];
        }
    }

    public function fetchMetaAdInsightsDevices(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') return ['data' => []];
        $adRow = $this->resolveAdMetaId($id);
        if ($adRow === null) return ['data' => []];
        $metaAdId = (string) $adRow['meta_ad_id'];
        $currency = $this->nullableString($adRow['currency'] ?? null);
        $cached = $this->getCachedInsights($id, 'devices');
        if ($cached !== null) return ['data' => $cached, 'currency' => $currency];
        try {
            $accessToken = $this->getActiveMetaAccessToken();
            $rows = $this->graphGetAll('/' . $metaAdId . '/insights', $accessToken, [
                'fields' => 'spend,impressions,reach,clicks,ctr,cpc,cpm',
                'breakdowns' => 'device_platform', 'date_preset' => 'maximum', 'limit' => 200,
            ]);
            $data = array_map(function(array $r) {
                return [
                    'device' => $r['device_platform'] ?? '',
                    'spend' => (float) ($r['spend'] ?? 0), 'impressions' => (int) ($r['impressions'] ?? 0),
                    'reach' => (int) ($r['reach'] ?? 0), 'clicks' => (int) ($r['clicks'] ?? 0),
                    'ctr' => (float) ($r['ctr'] ?? 0), 'cpc' => (float) ($r['cpc'] ?? 0), 'cpm' => (float) ($r['cpm'] ?? 0),
                ];
            }, $rows);
            $this->saveInsightsCache($id, 'devices', $data);
            return ['data' => $data, 'currency' => $currency];
        } catch (\Throwable $e) {
            return ['data' => [], 'error' => $e->getMessage(), 'currency' => $currency];
        }
    }

    private function autoSyncIfNeeded(): void
    {
        // Auto-sync if data is older than 20 minutes (respects 120s cooldown)
        $this->ensureMetaAdsSyncCacheTable();
        $row = $this->database->fetchOne('SELECT last_synced_at FROM meta_ads_sync_cache WHERE id = :id LIMIT 1', [':id' => 'meta-ads-sync-default']);
        $lastTime = $row !== null && !empty($row['last_synced_at']) ? strtotime((string) $row['last_synced_at']) : 0;
        if ($lastTime > 0 && (time() - $lastTime) < 1200) {
            return; // Synced within last 20 minutes
        }
        $cooldown = $this->manualSyncCooldownRemaining();
        if ($cooldown > 0) {
            return; // Still in cooldown
        }
        // Spawn background sync (non-blocking). Falls back to synchronous if exec unavailable.
        if (!$this->spawnBackgroundSync(false)) {
            try {
                $result = $this->syncAllConnections();
                $result['syncDurationMs'] = 0;
                $this->saveSyncResultsToCache($result, false);
            } catch (\Throwable $e) {
                // Silently fail - don't block the page load
            }
        }
    }
    /**
     * Spawn the CLI sync script as a background process.
     * Returns true if successfully spawned, false if exec is unavailable (caller should fall back to synchronous).
     */
    private function spawnBackgroundSync(bool $manual = false): bool
    {
        $phpBin = PHP_BINARY ?: 'php';
        $script = dirname(__DIR__) . '/bin/sync_meta_ads.php';
        if (!file_exists($script)) {
            return false;
        }

        $manualFlag = $manual ? ' --manual' : '';
        $escapedBin = escapeshellarg($phpBin);
        $escapedScript = escapeshellarg($script);

        try {
            if (PHP_OS_FAMILY === 'Windows') {
                // Windows: start /B runs in background without a new window
                $cmd = 'start /B "" ' . $escapedBin . ' ' . $escapedScript . $manualFlag . ' > NUL 2>&1';
                pclose(popen($cmd, 'r'));
            } else {
                // Linux/Mac: nohup + & runs in background, redirect all output to /dev/null
                $cmd = 'nohup ' . $escapedBin . ' ' . $escapedScript . $manualFlag . ' > /dev/null 2>&1 &';
                exec($cmd);
            }
            return true;
        } catch (\Throwable $e) {
            // exec may be disabled on shared hosting
            return false;
        }
    }

    private function detectAdAccountCurrency(): ?string
    {
        $row = $this->database->fetchOne('SELECT currency FROM meta_ad_accounts WHERE currency IS NOT NULL ORDER BY updated_at DESC LIMIT 1');
        return $row !== null ? (string) $row['currency'] : null;
    }

    private function ensureMetaAdsInsightsDailyTable(): void
    {
        $this->database->execute(
            'CREATE TABLE IF NOT EXISTS meta_ads_insights_daily (
                id VARCHAR(64) NOT NULL,
                ad_id VARCHAR(64) NOT NULL,
                meta_ad_id VARCHAR(64) NOT NULL,
                insight_date DATE NOT NULL,
                spend DECIMAL(14,4) NOT NULL DEFAULT 0,
                impressions INT NOT NULL DEFAULT 0,
                reach INT NOT NULL DEFAULT 0,
                clicks INT NOT NULL DEFAULT 0,
                ctr DECIMAL(12,6) DEFAULT NULL,
                cpc DECIMAL(14,4) DEFAULT NULL,
                cpm DECIMAL(14,4) DEFAULT NULL,
                conversions DECIMAL(14,4) DEFAULT NULL,
                currency VARCHAR(16) DEFAULT NULL,
                synced_at DATETIME DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_meta_ads_insights_daily_ad_date (ad_id, insight_date),
                KEY idx_meta_ads_insights_daily_date (insight_date),
                KEY idx_meta_ads_insights_daily_meta_ad (meta_ad_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    /**
     * Marketing portfolio dashboard: range-accurate spend from daily insights +
     * app order attribution via source_ad (booked vs realized ROAS).
     */
    public function fetchMarketingDashboard(array $params = []): array
    {
        $this->currentUser();
        $this->autoSyncIfNeeded();
        $this->ensureMetaAdsInsightsDailyTable();

        $from = $this->normalizeDateOnly((string) ($params['from'] ?? ''));
        $to = $this->normalizeDateOnly((string) ($params['to'] ?? ''));
        if ($from === '' || $to === '') {
            $to = gmdate('Y-m-d');
            $from = gmdate('Y-m-d', strtotime($to . ' -6 days'));
        }
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $prev = $this->previousDateWindow($from, $to);
        $settingsRow = $this->fetchMetaAdsSettingsRow();
        $adsCode = strtoupper(trim((string) ($settingsRow['display_currency_code'] ?? '')) ?: ($this->detectAdAccountCurrency() ?? 'BDT'));
        $rateToBdt = $this->resolveExchangeRate($adsCode, $settingsRow);

        $currentInsights = $this->aggregateDailyInsights($from, $to);
        $previousInsights = $this->aggregateDailyInsights($prev['from'], $prev['to']);
        $currentOrders = $this->aggregateAttributedOrders($from, $to);
        $previousOrders = $this->aggregateAttributedOrders($prev['from'], $prev['to']);
        $pipeline = $this->aggregateAttributedPipeline();
        $series = $this->buildMarketingSeries($from, $to);
        $campaigns = $this->buildCampaignPerformance($from, $to);
        $recentOrders = $this->fetchRecentAttributedOrders(10);
        $alerts = $this->buildMarketingAlerts($currentInsights, $currentOrders, $adsCode, $rateToBdt);

        $kpis = $this->composeMarketingKpis($currentInsights, $currentOrders, $pipeline);
        $previousKpis = $this->composeMarketingKpis($previousInsights, $previousOrders, ['count' => 0, 'value' => 0, 'byStatus' => []]);

        $syncRow = $this->database->fetchOne(
            'SELECT last_synced_at FROM meta_ads_sync_cache WHERE id = :id LIMIT 1',
            [':id' => 'meta-ads-sync-default']
        );
        $lastSyncedAt = $this->toIso($syncRow['last_synced_at'] ?? null);
        $lastTs = $syncRow !== null && !empty($syncRow['last_synced_at'])
            ? strtotime((string) $syncRow['last_synced_at'])
            : 0;
        $stale = $lastTs <= 0 || (time() - $lastTs) > 1200;

        $activeAds = (int) (($this->database->fetchOne(
            "SELECT COUNT(*) AS c FROM meta_ads WHERE COALESCE(effective_status, status) = 'ACTIVE'"
        )['c'] ?? 0));
        $activeCampaigns = (int) (($this->database->fetchOne(
            "SELECT COUNT(*) AS c FROM meta_campaigns WHERE COALESCE(effective_status, status) = 'ACTIVE'"
        )['c'] ?? 0));
        $dailyRowCount = (int) (($this->database->fetchOne(
            'SELECT COUNT(*) AS c FROM meta_ads_insights_daily'
        )['c'] ?? 0));

        return [
            'currency' => [
                'adsCode' => $adsCode,
                'rateToBdt' => $rateToBdt,
                'exchangeRateMode' => (string) ($settingsRow['exchange_rate_mode'] ?? 'fixed'),
                'vatPercentage' => $settingsRow['vat_percentage'] !== null ? (float) $settingsRow['vat_percentage'] : null,
                'realtimeRateCache' => $settingsRow['realtime_rate_cache'] !== null ? (float) $settingsRow['realtime_rate_cache'] : null,
                'realtimeRateUpdatedAt' => $this->toIso($settingsRow['realtime_rate_updated_at'] ?? null),
            ],
            'period' => [
                'from' => $from,
                'to' => $to,
                'previousFrom' => $prev['from'],
                'previousTo' => $prev['to'],
            ],
            'kpis' => $kpis,
            'previousKpis' => $previousKpis,
            'series' => $series,
            'campaigns' => $campaigns,
            'pipeline' => $pipeline['byStatus'],
            'recentOrders' => $recentOrders,
            'alerts' => $alerts,
            'meta' => [
                'lastSyncedAt' => $lastSyncedAt,
                'stale' => $stale,
                'activeAds' => $activeAds,
                'activeCampaigns' => $activeCampaigns,
                'hasDailyInsights' => $dailyRowCount > 0,
                'definitions' => [
                    'spend' => 'Sum of Meta daily insights spend in the range (ads currency).',
                    'purchases' => 'App orders with sourceAd set and order_date in range.',
                    'bookedRevenue' => 'Sum of those order totals (BDT) — orders placed, any status.',
                    'realizedRevenue' => 'Sum of completed (delivered) attributed order totals with order_date in range (BDT).',
                    'bookedRoas' => 'bookedRevenue (BDT) / spend converted to BDT.',
                    'realizedRoas' => 'realizedRevenue (BDT) / spend converted to BDT.',
                    'note' => 'Same-day ROAS is directional only; use multi-day windows. Delivery lag means realized ROAS matures over time.',
                ],
            ],
        ];
    }

    private function previousDateWindow(string $from, string $to): array
    {
        $start = new \DateTimeImmutable($from . ' 00:00:00', $this->utcTimezone());
        $end = new \DateTimeImmutable($to . ' 00:00:00', $this->utcTimezone());
        $days = (int) $start->diff($end)->days + 1;
        $prevEnd = $start->modify('-1 day');
        $prevStart = $prevEnd->modify('-' . ($days - 1) . ' days');
        return [
            'from' => $prevStart->format('Y-m-d'),
            'to' => $prevEnd->format('Y-m-d'),
        ];
    }

    private function aggregateDailyInsights(string $from, string $to): array
    {
        $row = $this->database->fetchOne(
            'SELECT
                COALESCE(SUM(spend), 0) AS spend,
                COALESCE(SUM(impressions), 0) AS impressions,
                COALESCE(SUM(reach), 0) AS reach,
                COALESCE(SUM(clicks), 0) AS clicks,
                COALESCE(SUM(conversions), 0) AS conversions,
                MAX(currency) AS currency
             FROM meta_ads_insights_daily
             WHERE insight_date >= :from_date AND insight_date <= :to_date',
            [':from_date' => $from, ':to_date' => $to]
        ) ?? [];

        $spend = (float) ($row['spend'] ?? 0);
        $impressions = (int) ($row['impressions'] ?? 0);
        $clicks = (int) ($row['clicks'] ?? 0);

        return [
            'spend' => $spend,
            'impressions' => $impressions,
            'reach' => (int) ($row['reach'] ?? 0),
            'clicks' => $clicks,
            'conversions' => (float) ($row['conversions'] ?? 0),
            'currency' => $this->nullableString($row['currency'] ?? null),
            'ctr' => $impressions > 0 ? ($clicks / $impressions) * 100 : 0.0,
            'cpc' => $clicks > 0 ? $spend / $clicks : 0.0,
            'cpm' => $impressions > 0 ? ($spend / $impressions) * 1000 : 0.0,
        ];
    }

    private function aggregateAttributedOrders(string $from, string $to): array
    {
        $row = $this->database->fetchOne(
            "SELECT
                COUNT(*) AS purchases,
                COALESCE(SUM(total), 0) AS booked_revenue,
                COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS delivered_count,
                COALESCE(SUM(CASE WHEN status = 'Completed' THEN total ELSE 0 END), 0) AS delivered_revenue,
                COALESCE(SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
                COALESCE(SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END), 0) AS returned_count,
                COALESCE(SUM(CASE WHEN status = 'Returned' THEN total ELSE 0 END), 0) AS returned_revenue
             FROM orders
             WHERE deleted_at IS NULL
               AND source_ad IS NOT NULL
               AND TRIM(source_ad) <> ''
               AND order_date >= :from_date
               AND order_date <= :to_date",
            [':from_date' => $from, ':to_date' => $to]
        ) ?? [];

        return [
            'purchases' => (int) ($row['purchases'] ?? 0),
            'bookedRevenue' => (float) ($row['booked_revenue'] ?? 0),
            'deliveredCount' => (int) ($row['delivered_count'] ?? 0),
            'deliveredRevenue' => (float) ($row['delivered_revenue'] ?? 0),
            'cancelledCount' => (int) ($row['cancelled_count'] ?? 0),
            'returnedCount' => (int) ($row['returned_count'] ?? 0),
            'returnedRevenue' => (float) ($row['returned_revenue'] ?? 0),
        ];
    }

    private function aggregateAttributedPipeline(): array
    {
        $openStatuses = ['On Hold', 'Processing', 'Courier assigned', 'Picked', 'Exchange pending', 'Created'];
        $placeholders = [];
        $bindings = [];
        foreach ($openStatuses as $i => $status) {
            $key = ':st' . $i;
            $placeholders[] = $key;
            $bindings[$key] = $status;
        }
        $in = implode(', ', $placeholders);

        $rows = $this->database->fetchAll(
            "SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS value
             FROM orders
             WHERE deleted_at IS NULL
               AND source_ad IS NOT NULL
               AND TRIM(source_ad) <> ''
               AND status IN ({$in})
             GROUP BY status
             ORDER BY cnt DESC",
            $bindings
        );

        $byStatus = [];
        $count = 0;
        $value = 0.0;
        foreach ($rows as $row) {
            $c = (int) ($row['cnt'] ?? 0);
            $v = (float) ($row['value'] ?? 0);
            $byStatus[] = [
                'status' => (string) ($row['status'] ?? ''),
                'count' => $c,
                'value' => $v,
            ];
            $count += $c;
            $value += $v;
        }

        return ['count' => $count, 'value' => $value, 'byStatus' => $byStatus];
    }

    private function composeMarketingKpis(array $insights, array $orders, array $pipeline): array
    {
        $spend = (float) ($insights['spend'] ?? 0);
        $purchases = (int) ($orders['purchases'] ?? 0);
        $bookedRevenue = (float) ($orders['bookedRevenue'] ?? 0);
        $deliveredCount = (int) ($orders['deliveredCount'] ?? 0);
        $deliveredRevenue = (float) ($orders['deliveredRevenue'] ?? 0);
        $cancelledCount = (int) ($orders['cancelledCount'] ?? 0);
        $returnedCount = (int) ($orders['returnedCount'] ?? 0);
        $eligible = max(0, $purchases - $cancelledCount);

        return [
            'spend' => $spend,
            'impressions' => (int) ($insights['impressions'] ?? 0),
            'reach' => (int) ($insights['reach'] ?? 0),
            'clicks' => (int) ($insights['clicks'] ?? 0),
            'ctr' => (float) ($insights['ctr'] ?? 0),
            'cpc' => (float) ($insights['cpc'] ?? 0),
            'cpm' => (float) ($insights['cpm'] ?? 0),
            'metaConversions' => (float) ($insights['conversions'] ?? 0),
            'purchases' => $purchases,
            'bookedRevenue' => $bookedRevenue,
            'deliveredCount' => $deliveredCount,
            'deliveredRevenue' => $deliveredRevenue,
            'cancelledCount' => $cancelledCount,
            'returnedCount' => $returnedCount,
            'returnedRevenue' => (float) ($orders['returnedRevenue'] ?? 0),
            'pipelineCount' => (int) ($pipeline['count'] ?? 0),
            'pipelineValue' => (float) ($pipeline['value'] ?? 0),
            // ROAS fields require BDT spend on the client (or when rate is known).
            // We expose raw ratios only when spend is already BDT; FE recomputes with FX.
            'cpa' => $purchases > 0 ? $spend / $purchases : 0.0,
            'costPerDelivered' => $deliveredCount > 0 ? $spend / $deliveredCount : 0.0,
            'deliveryRate' => $eligible > 0 ? ($deliveredCount / $eligible) * 100 : 0.0,
            'returnRate' => $purchases > 0 ? ($returnedCount / $purchases) * 100 : 0.0,
        ];
    }

    private function buildMarketingSeries(string $from, string $to): array
    {
        $insightRows = $this->database->fetchAll(
            'SELECT insight_date AS d,
                    COALESCE(SUM(spend), 0) AS spend,
                    COALESCE(SUM(impressions), 0) AS impressions,
                    COALESCE(SUM(clicks), 0) AS clicks
             FROM meta_ads_insights_daily
             WHERE insight_date >= :from_date AND insight_date <= :to_date
             GROUP BY insight_date',
            [':from_date' => $from, ':to_date' => $to]
        );
        $insightsByDate = [];
        foreach ($insightRows as $row) {
            $insightsByDate[(string) $row['d']] = $row;
        }

        $orderRows = $this->database->fetchAll(
            "SELECT order_date AS d,
                    COUNT(*) AS purchases,
                    COALESCE(SUM(total), 0) AS booked_revenue,
                    COALESCE(SUM(CASE WHEN status = 'Completed' THEN total ELSE 0 END), 0) AS delivered_revenue,
                    COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS delivered_count
             FROM orders
             WHERE deleted_at IS NULL
               AND source_ad IS NOT NULL
               AND TRIM(source_ad) <> ''
               AND order_date >= :from_date
               AND order_date <= :to_date
             GROUP BY order_date",
            [':from_date' => $from, ':to_date' => $to]
        );
        $ordersByDate = [];
        foreach ($orderRows as $row) {
            $ordersByDate[(string) $row['d']] = $row;
        }

        $series = [];
        $cursor = new \DateTimeImmutable($from . ' 00:00:00', $this->utcTimezone());
        $end = new \DateTimeImmutable($to . ' 00:00:00', $this->utcTimezone());
        while ($cursor <= $end) {
            $key = $cursor->format('Y-m-d');
            $ins = $insightsByDate[$key] ?? null;
            $ord = $ordersByDate[$key] ?? null;
            $spend = (float) ($ins['spend'] ?? 0);
            $booked = (float) ($ord['booked_revenue'] ?? 0);
            $delivered = (float) ($ord['delivered_revenue'] ?? 0);
            $series[] = [
                'date' => $key,
                'spend' => $spend,
                'impressions' => (int) ($ins['impressions'] ?? 0),
                'clicks' => (int) ($ins['clicks'] ?? 0),
                'purchases' => (int) ($ord['purchases'] ?? 0),
                'bookedRevenue' => $booked,
                'deliveredRevenue' => $delivered,
                'deliveredCount' => (int) ($ord['delivered_count'] ?? 0),
            ];
            $cursor = $cursor->modify('+1 day');
        }
        return $series;
    }

    private function buildCampaignPerformance(string $from, string $to): array
    {
        $spendRows = $this->database->fetchAll(
            'SELECT
                COALESCE(mc.id, "") AS campaign_id,
                COALESCE(mc.name, "Unassigned Campaign") AS campaign_name,
                COALESCE(SUM(d.spend), 0) AS spend,
                COALESCE(SUM(d.impressions), 0) AS impressions,
                COALESCE(SUM(d.clicks), 0) AS clicks,
                COALESCE(SUM(d.conversions), 0) AS conversions
             FROM meta_ads_insights_daily d
             INNER JOIN meta_ads ma ON ma.id = d.ad_id
             LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id
             WHERE d.insight_date >= :from_date AND d.insight_date <= :to_date
             GROUP BY COALESCE(mc.id, ""), COALESCE(mc.name, "Unassigned Campaign")',
            [':from_date' => $from, ':to_date' => $to]
        );

        $orderRows = $this->database->fetchAll(
            "SELECT
                o.source_ad AS source_ad,
                COALESCE(mc.id, '') AS campaign_id,
                COALESCE(mc.name, 'Unassigned Campaign') AS campaign_name,
                COUNT(*) AS purchases,
                COALESCE(SUM(o.total), 0) AS booked_revenue,
                COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN 1 ELSE 0 END), 0) AS delivered_count,
                COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total ELSE 0 END), 0) AS delivered_revenue,
                COALESCE(SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
                COALESCE(SUM(CASE WHEN o.status = 'Returned' THEN 1 ELSE 0 END), 0) AS returned_count
             FROM orders o
             LEFT JOIN meta_ads ma ON ma.id = o.source_ad OR ma.meta_ad_id = o.source_ad
             LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id
             WHERE o.deleted_at IS NULL
               AND o.source_ad IS NOT NULL
               AND TRIM(o.source_ad) <> ''
               AND o.order_date >= :from_date
               AND o.order_date <= :to_date
             GROUP BY o.source_ad, COALESCE(mc.id, ''), COALESCE(mc.name, 'Unassigned Campaign')",
            [':from_date' => $from, ':to_date' => $to]
        );

        $map = [];
        foreach ($spendRows as $row) {
            $key = (string) ($row['campaign_id'] ?? '') . '|' . (string) ($row['campaign_name'] ?? '');
            $map[$key] = [
                'id' => (string) ($row['campaign_id'] ?? ''),
                'name' => (string) ($row['campaign_name'] ?? 'Unassigned Campaign'),
                'spend' => (float) ($row['spend'] ?? 0),
                'impressions' => (int) ($row['impressions'] ?? 0),
                'clicks' => (int) ($row['clicks'] ?? 0),
                'conversions' => (float) ($row['conversions'] ?? 0),
                'purchases' => 0,
                'bookedRevenue' => 0.0,
                'deliveredCount' => 0,
                'deliveredRevenue' => 0.0,
                'cancelledCount' => 0,
                'returnedCount' => 0,
            ];
        }

        foreach ($orderRows as $row) {
            $name = (string) ($row['campaign_name'] ?? 'Unassigned Campaign');
            $id = (string) ($row['campaign_id'] ?? '');
            $key = $id . '|' . $name;
            if (!isset($map[$key])) {
                $map[$key] = [
                    'id' => $id,
                    'name' => $name,
                    'spend' => 0.0,
                    'impressions' => 0,
                    'clicks' => 0,
                    'conversions' => 0.0,
                    'purchases' => 0,
                    'bookedRevenue' => 0.0,
                    'deliveredCount' => 0,
                    'deliveredRevenue' => 0.0,
                    'cancelledCount' => 0,
                    'returnedCount' => 0,
                ];
            }
            $map[$key]['purchases'] += (int) ($row['purchases'] ?? 0);
            $map[$key]['bookedRevenue'] += (float) ($row['booked_revenue'] ?? 0);
            $map[$key]['deliveredCount'] += (int) ($row['delivered_count'] ?? 0);
            $map[$key]['deliveredRevenue'] += (float) ($row['delivered_revenue'] ?? 0);
            $map[$key]['cancelledCount'] += (int) ($row['cancelled_count'] ?? 0);
            $map[$key]['returnedCount'] += (int) ($row['returned_count'] ?? 0);
        }

        $list = array_values($map);
        usort($list, static function (array $a, array $b): int {
            return $b['bookedRevenue'] <=> $a['bookedRevenue'] ?: $b['spend'] <=> $a['spend'];
        });
        return $list;
    }

    private function fetchRecentAttributedOrders(int $limit = 10): array
    {
        $limit = max(1, min(50, $limit));
        $rows = $this->database->fetchAll(
            "SELECT o.id, o.order_number, o.order_date, o.status, o.total, o.source_ad,
                    ma.name AS ad_name, mc.name AS campaign_name
             FROM orders o
             LEFT JOIN meta_ads ma ON ma.id = o.source_ad OR ma.meta_ad_id = o.source_ad
             LEFT JOIN meta_campaigns mc ON mc.id = ma.campaign_id
             WHERE o.deleted_at IS NULL
               AND o.source_ad IS NOT NULL
               AND TRIM(o.source_ad) <> ''
             ORDER BY o.order_date DESC, o.created_at DESC
             LIMIT {$limit}"
        );
        return array_map(static function (array $row): array {
            return [
                'id' => (string) ($row['id'] ?? ''),
                'orderNumber' => (string) ($row['order_number'] ?? ''),
                'orderDate' => (string) ($row['order_date'] ?? ''),
                'status' => (string) ($row['status'] ?? ''),
                'total' => (float) ($row['total'] ?? 0),
                'sourceAd' => (string) ($row['source_ad'] ?? ''),
                'adName' => (string) ($row['ad_name'] ?? ''),
                'campaignName' => (string) ($row['campaign_name'] ?? ''),
            ];
        }, $rows);
    }

    private function buildMarketingAlerts(array $insights, array $orders, string $adsCode, ?float $rateToBdt): array
    {
        $alerts = [];
        $spend = (float) ($insights['spend'] ?? 0);
        $purchases = (int) ($orders['purchases'] ?? 0);
        $booked = (float) ($orders['bookedRevenue'] ?? 0);
        $returned = (int) ($orders['returnedCount'] ?? 0);

        if (strtoupper($adsCode) !== 'BDT' && ($rateToBdt === null || $rateToBdt <= 0)) {
            $alerts[] = [
                'severity' => 'warning',
                'code' => 'missing_exchange_rate',
                'message' => 'Exchange rate is not set. Spend cannot be converted to ৳ until you set 1 ' . $adsCode . ' = ? ৳ in Settings → Meta Ads.',
            ];
        }

        $dailyCount = (int) (($this->database->fetchOne('SELECT COUNT(*) AS c FROM meta_ads_insights_daily')['c'] ?? 0));
        if ($dailyCount === 0) {
            $alerts[] = [
                'severity' => 'info',
                'code' => 'no_daily_insights',
                'message' => 'No daily ad insights yet. Run Sync Now on Meta Ads so spend and trends use real daily data.',
            ];
        }

        if ($spend > 0 && $purchases === 0) {
            $alerts[] = [
                'severity' => 'warning',
                'code' => 'spend_no_orders',
                'message' => 'Ads spent money in this range but no attributed orders (source ad) were found. Check order attribution.',
            ];
        }

        $spendBdt = strtoupper($adsCode) === 'BDT' || ($rateToBdt !== null && $rateToBdt > 0)
            ? (strtoupper($adsCode) === 'BDT' ? $spend : $spend * (float) $rateToBdt)
            : null;
        if ($spendBdt !== null && $spendBdt > 0 && $booked > 0 && ($booked / $spendBdt) < 1) {
            $alerts[] = [
                'severity' => 'warning',
                'code' => 'low_booked_roas',
                'message' => 'Booked ROAS is below 1x for this range (order value vs ad spend).',
            ];
        }

        if ($purchases >= 5 && $returned / max(1, $purchases) >= 0.2) {
            $alerts[] = [
                'severity' => 'danger',
                'code' => 'high_return_rate',
                'message' => 'Return rate on ad-attributed orders is high (≥20%). Review creatives and product fit.',
            ];
        }

        return $alerts;
    }
}