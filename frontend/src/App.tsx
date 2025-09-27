import React, { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import ClassDetail from "./pages/ClassDetail";
import { getToken, logout, me } from "./api";


function RequireAuth() {
const token = getToken();
const location = useLocation();
if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
return <Outlet />;
}


function Shell({ children }: { children: React.ReactNode }) {
const nav = useNavigate();
const [email, setEmail] = useState<string | null>(null);
useEffect(() => { me().then((u) => setEmail(u.email)).catch(() => setEmail(null)); }, []);
return (
<div className="app-bg min-h-screen">
<header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
<div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
<div className="flex items-center gap-2">
<div className="grid h-9 w-9 place-items-center rounded-xl2 bg-brand-600 text-white shadow-soft">ES</div>
<span className="text-lg font-semibold text-slate-800">EduSense</span>
</div>
<div className="flex items-center gap-3 text-sm text-slate-600">
{email && <span className="hidden sm:inline">{email}</span>}
<button className="rounded-xl2 border border-slate-200 bg-white px-3 py-1.5 hover:bg-brand-50" onClick={() => { logout(); nav("/login"); }}>Logout</button>
</div>
</div>
</header>
<main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
</div>
);
}


export default function App() {
return (
<Routes>
<Route path="/login" element={<Login />} />
<Route path="/register" element={<Register />} />


<Route element={<RequireAuth />}>
<Route path="/" element={<Shell><Dashboard /></Shell>} />
<Route path="/classes/:id" element={<Shell><ClassDetail /></Shell>} />
</Route>


<Route path="*" element={<Navigate to="/" replace />} />
</Routes>
);
}