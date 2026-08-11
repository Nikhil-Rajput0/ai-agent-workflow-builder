"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthenticationStatus, useSignInEmailPassword, useSignUpEmailPassword } from "@nhost/nextjs";

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthenticationStatus();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { signInEmailPassword, isLoading: signingIn, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp, error: signUpError } = useSignUpEmailPassword();

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, router]);

  async function submit(e) {
    e.preventDefault();
    if (mode === "signin") {
      const res = await signInEmailPassword(email, password);
      if (res.isSuccess) router.push("/dashboard");
    } else {
      const res = await signUpEmailPassword(email, password);
      if (res.isSuccess) router.push("/dashboard");
    }
  }

  const error = mode === "signin" ? signInError : signUpError;
  const loading = signingIn || signingUp;

  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={submit} className="card" style={{ width: 360, display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>AI Agent Workflow Builder</h1>
        <p style={{ color: "#9aa3b5", marginTop: 0 }}>
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />
        {error && <p style={{ color: "#ff7d7d", fontSize: 13 }}>{error.message}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2f3646",
  background: "#0b0d12",
  color: "#e6e8ec",
};
