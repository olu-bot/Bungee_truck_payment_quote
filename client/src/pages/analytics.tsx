import { useState, useMemo, lazy, Suspense } from "react";
import { useFirebaseAuth } from "@/components/firebase-auth";
import { canUseAnalytics } from "@/lib/subscription";
import { BarChart3, History } from "lucide-react";

const Dashboard = lazy(() => import("@/pages/analytics/dashboard"));
const QuoteHistory = lazy(() => import("@/pages/quote-history"));

type Tab = "dashboard" | "history";

export default function Analytics() {
  const { user } = useFirebaseAuth();
  const hasDashboard = canUseAnalytics(user);
  const [activeTab, setActiveTab] = useState<Tab>(hasDashboard ? "dashboard" : "history");

  const tabs: { id: Tab; label: string; icon: typeof BarChart3; gated?: boolean }[] = useMemo(() => {
    const items: { id: Tab; label: string; icon: typeof BarChart3; gated?: boolean }[] = [];
    if (hasDashboard) {
      items.push({ id: "dashboard", label: "Dashboard", icon: BarChart3 });
    }
    items.push({ id: "history", label: "Quote History", icon: History });
    return items;
  }, [hasDashboard]);

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-xs font-medium
                border-b-2 -mb-px transition-colors
                ${isActive
                  ? "border-orange-500 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300"
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
          </div>
        }
      >
        {activeTab === "dashboard" && hasDashboard && <Dashboard />}
        {activeTab === "history" && <QuoteHistory />}
      </Suspense>
    </div>
  );
}
