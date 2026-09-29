import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/monitors", label: "Monitors", end: false },
  { to: "/incidents", label: "Incidents", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">👁️</span>
            <span className="text-lg font-bold tracking-tight">SiteWatch</span>
            <span className="hidden rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400 sm:inline">
              self-hosted
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-400 sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-slate-700 px-3 py-1.5 font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col sm:flex-row">
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 px-2 py-2 sm:w-52 sm:flex-col sm:border-b-0 sm:border-r sm:px-3 sm:py-4">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-blue-600/15 text-blue-400"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <main className="flex-1 px-4 py-6 sm:px-6">
            <Outlet />
          </main>
        </div>

        <footer className="border-t border-slate-800 px-6 py-3 text-xs text-slate-600">
          SiteWatch — lightweight self-hosted website &amp; API monitoring
        </footer>
      </div>
    </div>
  );
}
