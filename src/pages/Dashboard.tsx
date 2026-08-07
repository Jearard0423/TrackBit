import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Dashboard({ user }: { user: any }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [title, setTitle] = useState('')

  useEffect(() => {
    fetchTasks()
  }, [])

  async function fetchTasks() {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    setTasks(data ?? [])
  }

  async function add() {
    if (!title) return
    await supabase.from('tasks').insert([{ user_id: user.id, title }])
    setTitle('')
    fetchTasks()
  }

  return (
    <div>
      <h2>Greetings, {user.email}</h2>
      <div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Quick add task" />
        <button onClick={add}>Add</button>
      </div>
      <h3>Your tasks</h3>
      <ul>
        {tasks.map(t => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
    </div>
  )
}
