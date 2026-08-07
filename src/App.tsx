import React, { useEffect, useState } from 'react'
import { Routes, Route, Link, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [user, setUser] = useState<any>(null)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <nav style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/logo.png" alt="TrackBit" style={{ height: 40 }} />
        <div>
          <Link to="/">Home</Link> |{' '}
          {user ? (
            <a
              href="#"
              onClick={async e => {
                e.preventDefault()
                await supabase.auth.signOut()
                setUser(null)
                navigate('/')
              }}
            >
              Logout
            </a>
          ) : (
            <>
              <Link to="/login">Login</Link> | <Link to="/register">Register</Link>
            </>
          )}
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<div>{user ? <Dashboard user={user} /> : <Home />}</div>} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </div>
  )
}

function Home() {
  return (
    <div>
      <h1>Welcome to TrackBit</h1>
      <p>A lightweight daily plan organizer.</p>
    </div>
  )
}
