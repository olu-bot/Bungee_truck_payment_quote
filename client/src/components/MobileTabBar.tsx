import { Link, useLocation } from "wouter";
import { Route as RouteIcon, History, Settings } from "lucide-react";

const TABS = [
  { path: "/", label: "Home", icon: RouteIcon },
  { path: "/history", label: "Quotes", icon: History },
  { path: "/profiles", label: "Settings", icon: Settings },
] as const;

export function MobileTabBar() {
  const [location] = useLocation();
  const routePath = location.split("?")[0] || "/";

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex items-stretch">
        {TABS.map(({ path, label, icon: Icon }) => {
          const isActive = routePath === path;
          return (
            <Link key={path} href={path} className="flex-1">
              <button
                type="button"
                className={`flex flex-col items-center justify-center w-full py-2 gap-0.5 transition-colors ${
                  isActive
                    ? "text-orange-600"
                    : "text-slate-400 active:text-slate-600"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            </Link>
          );
        })}
      </div>
      {/* Safe area spacer for iOS home indicator */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
