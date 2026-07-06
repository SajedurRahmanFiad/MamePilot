<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class MetaAdsApi extends BaseService
{
    private const DEFAULT_GRAPH_VERSION = 'v25.0';
    private const DEFAULT_SCOPES = 'email,public_profile,ads_read,business_management';

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

        return [
            'appId' => (string) ($row['app_id'] ?? $config['appId']),
            'appSecret' => (string) ($row['app_secret'] ?? $config['appSecret']),
            'redirectUri' => (string) ($row['redirect_uri'] ?? $config['redirectUri']),
            'loginConfigId' => (string) ($row['login_config_id'] ?? $config['loginConfigId']),
            'graphVersion' => (string) ($row['graph_version'] ?? $config['graphVersion']),
            'oauthScopes' => (string) ($row['oauth_scopes'] ?? $config['oauthScopes']),
        ];
    }

    public function updateMetaAdsSettings(array $params): array
    {
        $this->requireAdmin();
        $this->ensureMetaAdsSettingsTable();

        $updates = [
            'app_id' => trim((string) ($params['appId'] ?? '')) !== '' ? trim((string) ($params['appId'] ?? '')) : null,
            'app_secret' => trim((string) ($params['appSecret'] ?? '')) !== '' ? trim((string) ($params['appSecret'] ?? '')) : null,
            'redirect_uri' => trim((string) ($params['redirectUri'] ?? '')) !== '' ? trim((string) ($params['redirectUri'] ?? '')) : null,
            'login_config_id' => trim((string) ($params['loginConfigId'] ?? '')) !== '' ? trim((string) ($params['loginConfigId'] ?? '')) : null,
            'graph_version' => trim((string) ($params['graphVersion'] ?? '')) !== '' ? trim((string) ($params['graphVersion'] ?? '')) : null,
            'oauth_scopes' => trim((string) ($params['oauthScopes'] ?? '')) !== '' ? trim((string) ($params['oauthScopes'] ?? '')) : null,
        ];

        return $this->saveSingleton('meta_ads_settings', 'meta-ads-default', $updates, fn(): array => $this->fetchMetaAdsSettings());
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
        return $this->syncAllConnections();
    }

    public function syncMetaAdsFromCli(): array
    {
        return $this->syncAllConnections();
    }

    public function fetchMetaAds(array $params = []): array
    {
        $this->currentUser();
        $businessId = trim((string) ($params['businessId'] ?? ''));
        $accountId = trim((string) ($params['adAccountId'] ?? ''));
        $campaignId = trim((string) ($params['campaignId'] ?? ''));
        $status = trim((string) ($params['status'] ?? ''));
        $from = $this->normalizeDateOnly((string) ($params['from'] ?? ''));
        $to = $this->normalizeDateOnly((string) ($params['to'] ?? ''));
        $search = trim((string) ($params['search'] ?? ''));

        $where = [];
        $bindings = [];
        if ($businessId !== '') {
            $where[] = 'ma.business_id = :business_id';
            $bindings[':business_id'] = $businessId;
        }
        if ($accountId !== '') {
            $where[] = 'ma.ad_account_id = :ad_account_id';
            $bindings[':ad_account_id'] = $accountId;
        }
        if ($campaignId !== '') {
            $where[] = 'ma.campaign_id = :campaign_id';
            $bindings[':campaign_id'] = $campaignId;
        }
        if ($status !== '') {
            $where[] = 'COALESCE(ma.effective_status, ma.status, ma.configured_status, "") = :status';
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
            $where[] = 'ma.name LIKE :search';
            $bindings[':search'] = '%' . $search . '%';
        }

        $whereSql = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);
        $rows = $this->database->fetchAll(
            "SELECT ma.*, mb.name AS business_name, mb.meta_business_id,
                    maa.name AS ad_account_name, maa.meta_ad_account_id,
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
             WHERE ma.id = :id OR ma.meta_ad_id = :id
             LIMIT 1',
            [':id' => $id]
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
            'effective_status' => '["ACTIVE","PAUSED","DELETED","ARCHIVED","IN_PROCESS","WITH_ISSUES"]',
            'limit' => 100,
        ]);
        foreach ($ads as $ad) {
            $this->upsertAd($localAccountId, $businessId, $ad);
            $counts['ads']++;
        }

        return $counts;
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
        if ($this->tableExists('meta_ads_settings')) {
            return;
        }

        $this->database->execute(
            'CREATE TABLE IF NOT EXISTS meta_ads_settings (
                id VARCHAR(64) NOT NULL,
                app_id VARCHAR(255) DEFAULT NULL,
                app_secret VARCHAR(500) DEFAULT NULL,
                redirect_uri VARCHAR(500) DEFAULT NULL,
                login_config_id VARCHAR(255) DEFAULT NULL,
                graph_version VARCHAR(64) DEFAULT NULL,
                oauth_scopes VARCHAR(500) DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    private function fetchMetaAdsSettingsRow(): array
    {
        $this->ensureMetaAdsSettingsTable();
        $row = $this->database->fetchOne('SELECT * FROM meta_ads_settings LIMIT 1');
        return is_array($row) ? $row : [];
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
                    COALESCE(SUM(spend), 0) AS total_spend
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
        ];
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
            'adAccountName' => (string) ($row['ad_account_name'] ?? ''),
            'businessName' => (string) ($row['business_name'] ?? 'Unassigned Business'),
            'status' => $this->displayStatus($row),
            'spend' => (float) ($row['spend'] ?? 0),
            'reach' => (int) ($row['reach'] ?? 0),
            'impressions' => (int) ($row['impressions'] ?? 0),
            'lastUpdatedAt' => $this->toIso($row['updated_time'] ?? $row['last_synced_at'] ?? $row['updated_at'] ?? null),
            'thumbnailUrl' => $this->nullableString($row['thumbnail_url'] ?? null),
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
}
