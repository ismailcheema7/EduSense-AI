import React, { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Button, Card, Input, Label } from "../ui";
import { login } from "../api";
import { useToast } from "../ui";


export default function Login() {
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [loading, setLoading] = useState(false);
const nav = useNavigate();
const loc = useLocation() as any;
const toast = useToast();


async function onSubmit(e: React.FormEvent) {
e.preventDefault();
setLoading(true);
try {
await login(email, password);
toast.push({ title: "Welcome back", kind: "success" });
nav(loc.state?.from?.pathname || "/");
} catch (err: any) {
toast.push({ title: err.message || "Login failed", kind: "error" });
} finally {
setLoading(false);
}
}


return (
<div className="grid min-h-screen place-items-center app-bg">
<Card className="w-full max-w-md p-6">
<h1 className="mb-1 text-center text-2xl font-semibold text-slate-800">Sign in</h1>
<p className="mb-6 text-center text-sm text-slate-600">Use your EduSense account</p>


<form onSubmit={onSubmit} className="space-y-4">
<div>
<Label htmlFor="email">Email</Label>
<Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
</div>
<div>
<Label htmlFor="password">Password</Label>
<Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
</div>
<Button type="submit" className="w-full" loading={loading}>Sign in</Button>
</form>


<p className="mt-6 text-center text-sm text-slate-600">
New here? <Link className="text-brand-700 hover:underline" to="/register">Create an account</Link>
</p>
</Card>
</div>
);
}