import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Input, Label } from "../ui";
import { register } from "../api";
import { useToast } from "../ui";


export default function Register() {
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [loading, setLoading] = useState(false);
const nav = useNavigate();
const toast = useToast();


async function onSubmit(e: React.FormEvent) {
e.preventDefault();
setLoading(true);
try {
await register(email, password);
toast.push({ title: "Welcome to EduSense", kind: "success" });
nav("/");
} catch (err: any) {
toast.push({ title: err.message || "Registration failed", kind: "error" });
} finally {
setLoading(false);
}
}


return (
<div className="grid min-h-screen place-items-center app-bg">
<Card className="w-full max-w-md p-6">
<h1 className="mb-1 text-center text-2xl font-semibold text-slate-800">Create account</h1>
<p className="mb-6 text-center text-sm text-slate-600">Get started in seconds</p>


<form onSubmit={onSubmit} className="space-y-4">
<div>
<Label htmlFor="email">Email</Label>
<Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
</div>
<div>
<Label htmlFor="password">Password</Label>
<Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
</div>
<Button type="submit" className="w-full" loading={loading}>Create account</Button>
</form>


<p className="mt-6 text-center text-sm text-slate-600">
Already have an account? <Link className="text-brand-700 hover:underline" to="/login">Sign in</Link>
</p>
</Card>
</div>
);
}