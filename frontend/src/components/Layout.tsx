import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { LanguageSwitch } from "./LanguageSwitch";
import {
  ActivityIcon,
  AlertIcon,
  GridIcon,
  LogoutIcon,
  RadarIcon,
  SlidersIcon,
} from "./Icons";

const NAV_ITEMS: { to: string; labelKey: MessageKey; end: boolean; icon: typeof GridIcon }[] = [
  { to: "/", labelKey: "nav.dashboard", end: true, icon: GridIcon },
  { to: "/monitors", labelKey: "nav.monitors", end: false, icon: RadarIcon },
  { to: "/incidents", labelKey: "nav.incidents", end: false, icon: AlertIcon },
  { to: "/settings", labelKey: "nav.settings", end: false, icon: SlidersIcon },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="sw-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col lg:flex-row">
        <aside className="sw-sidebar flex flex-col lg:w-[250px] lg:shrink-0">
          <div className="flex items-center gap-3 px-4 py-4 lg:px-5 lg:py-5">
            <div className="sw-brand-mark">
              <RadarIcon size={21} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-bold tracking-tight text-slate-50">
                {t("app.name")}
              </div>
              <div className="truncate text-[10.5px] text-slate-500">{t("app.tagline")}</div>
            </div>
            <span className="ml-auto hidden whitespace-nowrap rounded-md border border-indigo-400/25 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-indigo-300 2xl:inline">
              {t("app.badge")}
            </span>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0 lg:pt-2">
            <div className="sw-nav-caption hidden lg:block">{t("nav.sectionOverview")}</div>
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.to} className="contents">
                  {index === 1 && (
                    <div className="sw-nav-caption hidden lg:block">{t("nav.sectionManage")}</div>
                  )}
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `sw-nav-link ${isActive ? "active" : ""}`
                    }
                  >
                    <Icon size={17} className="shrink-0" />
                    <span>{t(item.labelKey)}</span>
                  </NavLink>
                </div>
              );
            })}
          </nav>

          <div className="mt-auto hidden px-4 pb-5 lg:block">
            <div className="sw-card sw-card-hover p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <ActivityIcon size={15} className="text-emerald-400" />
                {t("app.systemHealthy")}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="sw-dot-live" />
                {t("app.updated")}
              </div>
            </div>
            <p className="mt-4 px-1 text-[10.5px] leading-relaxed text-slate-600">
              {t("app.footer")}
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sw-topbar flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
            <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
              <span className="sw-dot-live" />
              <span className="font-semibold text-emerald-300/90">{t("app.live")}</span>
              <span className="hidden text-slate-600 sm:inline">·</span>
              <span className="hidden text-slate-500 sm:inline">{t("app.updated")}</span>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <LanguageSwitch />
              <div className="hidden items-center gap-2.5 md:flex">
                <div className="sw-avatar">
                  {(user?.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="hidden text-right xl:block">
                  <div className="text-[10px] uppercase tracking-wider text-slate-600">
                    {t("nav.signedInAs")}
                  </div>
                  <div className="max-w-[180px] truncate text-[11.5px] text-slate-300">
                    {user?.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="sw-btn sw-btn-ghost sw-btn-sm"
              >
                <LogoutIcon size={14} />
                <span className="hidden sm:inline">{t("nav.signOut")}</span>
              </button>
            </div>
          </header>

          <main className="sw-fade-in flex-1 px-4 py-7 sm:px-7 lg:px-9 lg:py-8">
            <Outlet />
          </main>

          <footer className="border-t border-white/5 px-5 py-4 text-[10.5px] text-slate-600 lg:hidden">
            {t("app.footer")}
          </footer>
        </div>
      </div>
    </div>
  );
}
