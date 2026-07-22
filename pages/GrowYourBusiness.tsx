import React, { useState } from 'react';
import { ChevronDown, RefreshCw, TrendingUp, AlertTriangle, CheckCircle, XCircle, Lightbulb } from 'lucide-react';
import { Button, LoadingOverlay } from '../components';
import { useBusinessRecommendations } from '../src/hooks/useQueries';
import { useRefreshBusinessRecommendations } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import type { BusinessRecommendation } from '../types';
import { theme } from '../theme';
import { formatDateTime } from '../utils';

const BADGE_STYLES: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  green: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-800',
    icon: <CheckCircle size={18} className="text-emerald-500" />,
  },
  yellow: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: <Lightbulb size={18} className="text-amber-500" />,
  },
  red: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: <AlertTriangle size={18} className="text-red-500" />,
  },
};

const TYPE_LABELS: Record<string, string> = {
  restock: 'Restock',
  run_ads: 'Run Ads',
  discontinue: 'Discontinue',
  trending_opportunity: 'Opportunity',
  price_adjustment: 'Price Adjustment',
  clearance: 'Clearance',
  general: 'Insight',
};

function RecommendationCard({ rec }: { rec: BusinessRecommendation }) {
  const style = BADGE_STYLES[rec.badgeColor] || BADGE_STYLES.green;
  const typeLabel = TYPE_LABELS[rec.type] || 'Insight';
  const products = (rec.metadata?.products ?? []) as Array<{ id: string; name: string; image: string; stock: number }>;

  return (
    <div className={`flex items-start gap-4 rounded-2xl border ${style.border} ${style.bg} p-5 transition-all hover:shadow-sm`}>
      <div className="mt-0.5 flex-shrink-0">
        {style.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold uppercase tracking-wider ${style.text} opacity-70`}>{typeLabel}</span>
          <h3 className={`text-sm font-black ${style.text}`}>{rec.title}</h3>
        </div>
        <p className={`mt-1.5 text-sm leading-relaxed ${style.text} opacity-90`}>{rec.description}</p>
        {products.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {products.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl bg-white/70 border border-gray-100 px-3 py-1.5">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="h-7 w-7 rounded-lg object-cover" />
                ) : (
                  <div className="h-7 w-7 rounded-lg bg-gray-200 flex items-center justify-center text-xs text-gray-400">?</div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate max-w-[140px]">{p.name}</p>
                  <p className="text-[10px] text-gray-400">{p.stock} in stock</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const GrowYourBusiness: React.FC = () => {
  const toast = useToastNotifications();
  const { data, isPending, error } = useBusinessRecommendations();
  const refreshMutation = useRefreshBusinessRecommendations();
  const [sectionOpen, setSectionOpen] = useState(true);

  const recommendations = data?.recommendations ?? [];
  const hasError = data?.error || error;
  const generatedAt = data?.generatedAt;
  const isCached = data?.cached;

  const handleRefresh = async () => {
    const toastId = toast.loading('Generating fresh recommendations...');
    try {
      const result = await refreshMutation.mutateAsync();
      if (result.error) {
        toast.update(toastId, result.error, 'error');
      } else {
        toast.update(toastId, `${result.recommendations.length} recommendations generated.`, 'success');
      }
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Failed to generate recommendations.', 'error');
    }
  };

  // Group by color for summary
  const greenCount = recommendations.filter(r => r.badgeColor === 'green').length;
  const yellowCount = recommendations.filter(r => r.badgeColor === 'yellow').length;
  const redCount = recommendations.filter(r => r.badgeColor === 'red').length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <LoadingOverlay isLoading={isPending && !data} message="Loading recommendations..." />

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-3">
            <TrendingUp size={28} className="text-primary-600" />
            Grow your business
          </h1>
          <p className="mt-1 text-sm text-gray-500">AI-powered recommendations to optimize your product portfolio and boost sales.</p>
        </div>
        <Button
          onClick={handleRefresh}
          variant="primary"
          disabled={refreshMutation.isPending}
          className="flex items-center gap-2"
        >
          <RefreshCw size={16} className={refreshMutation.isPending ? 'animate-spin' : ''} />
          {refreshMutation.isPending ? 'Generating...' : 'Refresh'}
        </Button>
      </div>

      {/* Error state */}
      {hasError && !isPending && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <XCircle size={32} className="mx-auto text-red-400 mb-3" />
          <p className="text-sm font-bold text-red-800">
            {typeof hasError === 'string' ? hasError : 'Unable to generate recommendations.'}
          </p>
          <p className="mt-1 text-xs text-red-600">
            Make sure a model is assigned to Grow Your Business in Developer Settings &gt; LLMs.
          </p>
        </div>
      )}

      {/* Recommendations Section */}
      {!hasError && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {/* Collapsible header */}
          <button
            onClick={() => setSectionOpen(!sectionOpen)}
            className="flex w-full items-center justify-between px-6 py-5 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-black text-gray-900">Recommendations</h2>
              {recommendations.length > 0 && (
                <div className="flex items-center gap-1.5">
                  {greenCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                      <CheckCircle size={12} /> {greenCount}
                    </span>
                  )}
                  {yellowCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                      <Lightbulb size={12} /> {yellowCount}
                    </span>
                  )}
                  {redCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
                      <AlertTriangle size={12} /> {redCount}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {generatedAt && (
                <span className="text-xs text-gray-400">
                  {isCached ? 'Cached' : 'Generated'} {formatDateTime(generatedAt)}
                </span>
              )}
              <ChevronDown
                size={20}
                className={`text-gray-400 transition-transform ${sectionOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {/* Collapsible content */}
          {sectionOpen && (
            <div className="px-6 pb-6 space-y-3">
              {isPending && !data && (
                <div className="py-12 text-center">
                  <RefreshCw size={24} className="mx-auto text-gray-300 animate-spin mb-3" />
                  <p className="text-sm text-gray-500">Analyzing your business data...</p>
                </div>
              )}

              {!isPending && recommendations.length === 0 && !hasError && (
                <div className="py-12 text-center">
                  <TrendingUp size={32} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm font-medium text-gray-500">No recommendations yet.</p>
                  <p className="mt-1 text-xs text-gray-400">Click "Refresh" to generate AI-powered insights from your business data.</p>
                </div>
              )}

              {recommendations.map((rec) => (
                <RecommendationCard key={rec.id} rec={rec} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default GrowYourBusiness;
