import { supabase } from "./lib/supabase";
import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");

  const handleLogin = async () => {
    await supabase.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    alert("ログインリンクをメールで送りました");
  };

  return (
    <div style={{ padding: 40 }}>
      <h2>ログイン</h2>

      <input
        type="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: 10, width: 250 }}
      />

      <div style={{ marginTop: 10 }}>
        <button onClick={handleLogin}>
          ログインリンクを送る
        </button>
      </div>
    </div>
  );
}