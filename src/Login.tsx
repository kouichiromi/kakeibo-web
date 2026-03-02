import { useState } from "react";
import { supabase } from "./lib/supabase";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: email
    });

    setLoading(false);

    if (error) {
      alert(error.message);
    } else {
      alert("ログインリンクをメールに送信しました");
    }
  };

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 12
    }}>
      <h2>家計簿ログイン</h2>

      <input
        type="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: 10, width: 250 }}
      />

      <button onClick={signIn} disabled={loading}>
        ログインリンク送信
      </button>
    </div>
  );
}