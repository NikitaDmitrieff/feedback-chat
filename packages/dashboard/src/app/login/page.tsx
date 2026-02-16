'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Github, Loader2, MessageSquareText, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const supabase = createClient()

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading('email')

    if (mode === 'signup') {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      })
      if (err) {
        setError(err.message)
        setLoading(null)
        return
      }
      window.location.href = '/projects'
      return
    }

    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) {
      setError(err.message)
      setLoading(null)
      return
    }
    window.location.href = '/projects'
  }

  async function handleOAuth(provider: 'github' | 'google') {
    setLoading(provider)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    if (err) {
      setError(err.message)
      setLoading(null)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card w-full max-w-sm p-8">
        {/* Branding */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
            <MessageSquareText className="h-5 w-5 text-muted" />
          </div>
          <h1 className="text-base font-medium text-fg">Feedback Chat</h1>
          <p className="mt-1 text-xs text-muted">
            {mode === 'signup' ? 'Create your account' : 'Sign in to your dashboard'}
          </p>
        </div>

        {/* OAuth buttons */}
        <div className="space-y-2.5">
          <button
            onClick={() => handleOAuth('google')}
            disabled={loading !== null}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-white/90 disabled:opacity-50"
          >
            {loading === 'google' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>

          <button
            onClick={() => handleOAuth('github')}
            disabled={loading !== null}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {loading === 'github' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Github className="h-4 w-4" />
            )}
            Continue with GitHub
          </button>
        </div>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-edge" />
          <span className="text-[11px] text-muted">or</span>
          <div className="h-px flex-1 bg-edge" />
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailPassword} className="space-y-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="input-field"
          />

          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="input-field pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-fg"
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading !== null || !email || !password}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-edge bg-surface text-sm text-fg transition-all hover:border-edge-hover hover:bg-surface-hover disabled:opacity-50"
          >
            {loading === 'email' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === 'signup' ? (
              'Create account'
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Mode switcher */}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-[11px] text-muted">
          {mode === 'signin' ? (
            <button onClick={() => { setMode('signup'); setError(null) }} className="transition-colors hover:text-fg">
              Don&apos;t have an account? <span className="text-fg">Sign up</span>
            </button>
          ) : (
            <button onClick={() => { setMode('signin'); setError(null) }} className="transition-colors hover:text-fg">
              Already have an account? <span className="text-fg">Sign in</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
