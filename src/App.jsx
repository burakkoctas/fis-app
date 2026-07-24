import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  Sparkles,
  Check,
  Trash2,
  Calendar as CalendarIcon,
  ListTodo,
  Flame,
  Timer,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ---------- helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function friendlyDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const t = new Date();
  const tom = new Date(t);
  tom.setDate(t.getDate() + 1);
  if (dateKey(d) === dateKey(t)) return "Bugün";
  if (dateKey(d) === dateKey(tom)) return "Yarın";
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}

const PRIORITY_META = {
  high: { label: "Yüksek", color: "#C4634F" },
  med: { label: "Orta", color: "#D9C36A" },
  low: { label: "Düşük", color: "#6E7580" },
};

// ---------- storage (Supabase — synced across devices) ----------
async function loadState(userId) {
  const out = { tasks: [], habits: [] };
  const [{ data: taskRows }, { data: habitRows }] = await Promise.all([
    supabase.from("tasks").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("habits").select("*").eq("user_id", userId),
  ]);
  out.tasks = (taskRows || []).map((r) => ({
    id: r.id, title: r.title, date: r.date, time: r.time, priority: r.priority, done: r.done,
  }));
  out.habits = (habitRows || []).map((r) => ({
    id: r.id, name: r.name, doneDates: r.done_dates || [], time: r.time || null,
  }));
  return out;
}

// ---------- AI parsing ----------
// Calls our own /api/parse-task serverless function, which holds the Gemini
// API key server-side and forwards the parsed JSON back to the app.
async function parseWithAI(rawText) {
  const now = new Date();
  const context = `Şu an: ${dateKey(now)} (${DAY_NAMES[now.getDay()]}), saat ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}. Kullanıcının saat dilimi yereldir.`;

  const resp = await fetch("/api/parse-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawText, context }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "AI ayrıştırma hatası");
  return data;
}

// ---------- main app ----------
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [tasks, setTasks] = useState([]);
  const [habits, setHabits] = useState([]);
  const [view, setView] = useState("tasks");
  const [loaded, setLoaded] = useState(false);
  const [quick, setQuick] = useState("");
  const [aiMode, setAiMode] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [pendingTask, setPendingTask] = useState(null); // parsed preview awaiting confirm

  // auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  // load + realtime subscribe once logged in
  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadState(userId).then((s) => {
      if (!active) return;
      setTasks(s.tasks);
      setHabits(s.habits);
      setLoaded(true);
    });

    const channel = supabase
      .channel("fis-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` }, () => {
        loadState(userId).then((s) => setTasks(s.tasks));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "habits", filter: `user_id=eq.${userId}` }, () => {
        loadState(userId).then((s) => setHabits(s.habits));
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const addTask = useCallback(
    async (t) => {
      const row = { title: t.title, date: t.date || null, time: t.time || null, priority: t.priority || "med", done: false, user_id: userId };
      const { data, error } = await supabase.from("tasks").insert(row).select().single();
      if (!error && data) {
        setTasks((prev) => [{ id: data.id, title: data.title, date: data.date, time: data.time, priority: data.priority, done: data.done }, ...prev]);
      }
    },
    [userId]
  );

  async function handleSubmit(extraFields = {}) {
    const text = quick.trim();
    if (!text) return;
    if (!aiMode) {
      addTask({
        title: text,
        date: extraFields.date || null,
        time: extraFields.time || null,
        priority: extraFields.priority || "med",
      });
      setQuick("");
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const parsed = await parseWithAI(text);
      setPendingTask(parsed);
    } catch (e) {
      setAiError("Ayrıştırılamadı, manuel eklemeyi dene.");
    } finally {
      setAiBusy(false);
    }
  }

  function confirmPending(editedTask) {
    addTask(editedTask);
    setPendingTask(null);
    setQuick("");
  }

  function toggleDone(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
    supabase.from("tasks").update({ done: !t.done }).eq("id", id).then(() => {});
  }
  function removeTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    supabase.from("tasks").delete().eq("id", id).then(() => {});
  }

  function toggleHabitToday(id) {
    const today = todayISO();
    const h = habits.find((x) => x.id === id);
    if (!h) return;
    const has = h.doneDates.includes(today);
    const nextDates = has ? h.doneDates.filter((d) => d !== today) : [...h.doneDates, today];
    setHabits((prev) => prev.map((x) => (x.id === id ? { ...x, doneDates: nextDates } : x)));
    supabase.from("habits").update({ done_dates: nextDates }).eq("id", id).then(() => {});
  }

  const [editingTask, setEditingTask] = useState(null);

  async function updateTask(updated) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    await supabase.from("tasks").update({
      title: updated.title,
      date: updated.date || null,
      time: updated.time || null,
      priority: updated.priority,
    }).eq("id", updated.id);
    setEditingTask(null);
  }

  const pending = tasks.filter((t) => !t.done);
  const NAV = [
    { key: "tasks", label: "Görevler", icon: ListTodo },
    { key: "calendar", label: "Takvim", icon: CalendarIcon },
    { key: "habits", label: "Alışkanlık", icon: Flame },
    { key: "focus", label: "Odak", icon: Timer },
  ];

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1C1B1F] text-[#9C9791]">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }
  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-[#1C1B1F] text-[#EDEAE4]" style={{ fontFamily: "ui-sans-serif, system-ui" }}>
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-56 md:flex-col border-r border-[#3A373D] p-5 gap-1">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <img
              src="/logo.png"
              alt="VakVak logo"
              className="w-7 h-7 object-contain"
            />
            <div className="text-2xl" style={{ fontFamily: "Georgia, serif" }}>VakVak</div>
          </div>
          <div className="text-xs text-[#9C9791] mt-1">yapılacaklar, sesle &amp; yazıyla</div>
        </div>
        {NAV.map((n) => (
          <NavButton key={n.key} n={n} active={view === n.key} onClick={() => setView(n.key)} />
        ))}
        <button onClick={() => supabase.auth.signOut()} className="mt-auto text-xs text-[#6E7580] text-left px-3 py-2">
          Çıkış yap
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col pb-20 md:pb-0 overflow-hidden">
        <header className="px-5 pt-6 pb-4 md:hidden flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/logo.png"
              alt="VakVak logo"
              className="w-6 h-6 object-contain"
            />
            <div className="text-2xl" style={{ fontFamily: "Georgia, serif" }}>VakVak</div>
          </div>
        </header>

        {view === "tasks" && (
          <TasksView
            quick={quick}
            setQuick={setQuick}
            aiMode={aiMode}
            setAiMode={setAiMode}
            aiBusy={aiBusy}
            aiError={aiError}
            onSubmit={handleSubmit}
            pendingTask={pendingTask}
            confirmPending={confirmPending}
            cancelPending={() => setPendingTask(null)}
            tasks={tasks}
            toggleDone={toggleDone}
            removeTask={removeTask}
            editTask={setEditingTask}
            editingTask={editingTask}
            updateTask={updateTask}
            habits={habits}
            toggleHabitToday={toggleHabitToday}
          />
        )}

        {view === "calendar" && <CalendarView tasks={pending} />}
        {view === "habits" && <HabitsView habits={habits} setHabits={setHabits} userId={userId} toggleHabitToday={toggleHabitToday} />}
        {view === "focus" && <FocusView />}
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-[#3A373D] bg-[#1C1B1F] flex justify-around py-2">
        {NAV.map((n) => (
          <button
            key={n.key}
            onClick={() => setView(n.key)}
            className="flex flex-col items-center gap-1 px-3 py-1 rounded-lg"
            style={{ color: view === n.key ? "#D9C36A" : "#9C9791" }}
          >
            <n.icon size={20} />
            <span className="text-[10px]">{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) setError("E-posta veya şifre hatalı.");
    } else {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) setError(error.message);
      else setSuccess("Hesap oluşturuldu! Şimdi giriş yapabilirsin.");
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1C1B1F] text-[#EDEAE4] px-6">
      <div className="w-full max-w-xs">
        <div className="text-2xl mb-1" style={{ fontFamily: "Georgia, serif" }}>VakVak</div>
        <div className="text-xs text-[#9C9791] mb-6">
          {mode === "login" ? "Hesabınla giriş yap." : "Yeni hesap oluştur."}
        </div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="ornek@eposta.com"
          type="email"
          className="w-full bg-[#262429] border border-[#3A373D] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#D9C36A] mb-2"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Şifre (en az 6 karakter)"
          type="password"
          className="w-full bg-[#262429] border border-[#3A373D] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#D9C36A] mb-3"
        />

        <button
          onClick={handleSubmit}
          disabled={busy}
          className="w-full py-2 rounded-xl bg-[#D9C36A] text-[#1C1B1F] text-sm font-medium mb-3"
        >
          {busy ? "Lütfen bekle..." : mode === "login" ? "Giriş yap" : "Hesap oluştur"}
        </button>

        {error && <div className="text-xs text-[#C4634F] mb-2">{error}</div>}
        {success && <div className="text-xs text-[#6BBF7A] mb-2">{success}</div>}

        <button
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); setSuccess(null); }}
          className="text-xs text-[#9C9791] underline"
        >
          {mode === "login" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
        </button>
      </div>
    </div>
  );
}


function NavButton({ n, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
      style={{
        background: active ? "#262429" : "transparent",
        color: active ? "#D9C36A" : "#9C9791",
      }}
    >
      <n.icon size={16} />
      {n.label}
    </button>
  );
}

// ---------- Tasks view (ana görev ekranı) ----------
function TasksView(props) {
  const {
    quick, setQuick, aiMode, setAiMode, aiBusy, aiError, onSubmit,
    pendingTask, confirmPending, cancelPending,
    tasks, toggleDone, removeTask, editTask, editingTask, updateTask,
    habits, toggleHabitToday,
  } = props;

  const today   = todayISO();
  const tomorrow = tomorrowISO();
  const now     = new Date();

  // Geçmiş görev = tarihi bugünden önce VEYA bugün+saati geçmiş, tamamlanmamış, sadece task
  function isOverdue(t) {
    if (t.done || !t.date) return false;
    if (t.date < today) return true;
    if (t.date === today && t.time) {
      const [h, m] = t.time.split(":").map(Number);
      const taskTime = new Date(); taskTime.setHours(h, m, 0, 0);
      return taskTime < now;
    }
    return false;
  }

  const overdue       = tasks.filter(t => isOverdue(t));
  const todayTasks    = tasks.filter(t => !t.done && !isOverdue(t) && t.date === today);
  const tomorrowTasks = tasks.filter(t => !t.done && t.date === tomorrow);
  const futureTasks   = tasks.filter(t => !t.done && !isOverdue(t) && t.date !== today && t.date !== tomorrow && (t.date > tomorrow || !t.date));
  const doneTasks     = tasks.filter(t => t.done);
  const pendingHabits = (habits || []).filter(h => !h.doneDates.includes(today));

  // Manuel mod state
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [manualPriority, setManualPriority] = useState("med");
  function handleManualSubmit() {
    onSubmit({ date: manualDate || null, time: manualTime || null, priority: manualPriority });
  }

  // Task row helper (inlined)
  function renderRow(t) {
    return editingTask?.id === t.id ? (
      <TaskEditCard key={t.id} task={t} onConfirm={updateTask} onCancel={() => editTask(null)} confirmLabel="Kaydet" showClose />
    ) : (
      <TaskRow key={t.id} t={t} onToggle={() => toggleDone(t.id)} onRemove={() => removeTask(t.id)} onEdit={() => editTask(t)} />
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* Sol: görev segmentleri */}
      <div className="flex-1 min-w-0 overflow-y-auto px-5 pt-4 md:pt-8 pb-6">
        {/* Hızlı ekle */}
        <div className="mb-4 max-w-2xl">
          <div className="flex items-center gap-2 bg-[#262429] border border-[#3A373D] rounded-xl px-3 py-2 focus-within:border-[#D9C36A] transition-colors">
            <button
              onClick={() => setAiMode(v => !v)}
              title={aiMode ? "AI açık" : "AI kapalı"}
              className="shrink-0"
              style={{ color: aiMode ? "#D9C36A" : "#6E7580" }}
            >
              <Sparkles size={18} />
            </button>
            <input
              value={quick}
              onChange={e => setQuick(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (aiMode ? onSubmit() : handleManualSubmit())}
              placeholder={aiMode ? "\"Per\u015fembe saat 2'de doktor randevusu\" gibi yaz..." : "Görev başlığı..."}
              className="flex-1 bg-transparent outline-none text-sm placeholder-[#6E7580]"
            />
            <button onClick={aiMode ? onSubmit : handleManualSubmit} disabled={aiBusy} className="shrink-0 text-[#EDEAE4]">
              {aiBusy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            </button>
          </div>
          {!aiMode && (
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                style={{ colorScheme: "dark" }}
                className="bg-[#262429] border border-[#3A373D] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#D9C36A] text-[#EDEAE4]" />
              <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)}
                style={{ colorScheme: "dark" }}
                className="bg-[#262429] border border-[#3A373D] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#D9C36A] text-[#EDEAE4]" />
              {Object.entries(PRIORITY_META).map(([key, meta]) => (
                <button key={key} onClick={() => setManualPriority(key)}
                  className="px-3 py-1.5 rounded-lg text-xs border transition-colors"
                  style={{
                    borderColor: manualPriority === key ? meta.color : "#3A373D",
                    color: manualPriority === key ? meta.color : "#6E7580",
                    background: manualPriority === key ? meta.color + "22" : "transparent",
                  }}>{meta.label}</button>
              ))}
            </div>
          )}
          {aiError && <div className="text-xs text-[#C4634F] mt-1">{aiError}</div>}
        </div>

        {pendingTask && (
          <div className="max-w-2xl">
            <TaskEditCard task={pendingTask} onConfirm={confirmPending} onCancel={cancelPending} confirmLabel="Onayla" />
          </div>
        )}

        <div className="max-w-2xl">
          {todayTasks.length === 0 && tomorrowTasks.length === 0 && futureTasks.length === 0 && pendingHabits.length === 0 && doneTasks.length === 0 && (
            <EmptyState text="Henüz görev yok. Yukarıdan bir tane ekle." />
          )}

          {todayTasks.length > 0 && (
            <Section title="Bugün">{todayTasks.map(renderRow)}</Section>
          )}
          {tomorrowTasks.length > 0 && (
            <Section title="Yarın">{tomorrowTasks.map(renderRow)}</Section>
          )}
          {futureTasks.length > 0 && (
            <Section title="İleri Tarihli">{futureTasks.map(renderRow)}</Section>
          )}
          {pendingHabits.length > 0 && (
            <Section title="Alışkanlıklar">
              {pendingHabits.map(h => (
                <div key={h.id} onClick={() => toggleHabitToday(h.id)}
                  className="flex items-center gap-3 bg-[#262429] border border-[#3A373D] rounded-lg px-3 py-2 cursor-pointer active:opacity-70">
                  <div className="w-5 h-5 rounded-full border-2 shrink-0" style={{ borderColor: "#D9C36A" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{h.name}</div>
                    {h.time && <div className="text-[11px] text-[#9C9791] mt-0.5">{h.time}</div>}
                  </div>
                  <Flame size={13} style={{ color: "#D9C36A", opacity: 0.6 }} />
                </div>
              ))}
            </Section>
          )}
          {doneTasks.length > 0 && (
            <Section title={`Tamamlandı (${doneTasks.length})`} muted>
              {doneTasks.map(renderRow)}
            </Section>
          )}
        </div>
      </div>

      {/* Sağ: Geçmiş Görevler (sadece masaüstü) */}
      <div className="hidden md:flex flex-col w-72 shrink-0 border-l border-[#3A373D] overflow-hidden">
        <div className="px-4 pt-8 pb-4 overflow-y-auto flex-1">
          {overdue.filter(t => !t.done).length > 0 && (
            <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "#C4634F22", borderLeft: "3px solid #C4634F", color: "#E8957A" }}>
              {overdue.filter(t => !t.done).length} tamamlanmamış geçmiş görev
            </div>
          )}
          <div className="text-xs uppercase tracking-wide text-[#6E7580] mb-3">Geçmiş Görevler</div>
          {overdue.length === 0 ? (
            <div className="text-xs text-[#6E7580] text-center py-8">Geçmiş görev yok ✓</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {overdue.map(t => (
                <div key={t.id} className="flex items-start gap-2 bg-[#262429] border border-[#3A373D] rounded-lg px-3 py-2 opacity-70">
                  <button
                    onClick={() => toggleDone(t.id)}
                    className="w-4 h-4 mt-0.5 rounded-full border shrink-0"
                    style={{ borderColor: "#C4634F", background: t.done ? "#C4634F" : "transparent" }}
                  >
                    {t.done && <Check size={10} color="#1C1B1F" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs truncate ${t.done ? "line-through text-[#6E7580]" : ""}`}>{t.title}</div>
                    <div className="text-[10px] text-[#C4634F] mt-0.5">
                      {t.date && friendlyDate(t.date)}{t.time && ` ${t.time}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, color }) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full border"
      style={{ borderColor: color || "#3A373D", color: color || "#9C9791" }}
    >
      {children}
    </span>
  );
}

function Section({ title, children, muted }) {
  return (
    <div className="mb-6">
      <div className={`text-xs uppercase tracking-wide mb-2 ${muted ? "text-[#6E7580]" : "text-[#9C9791]"}`}>{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function TaskRow({ t, onToggle, onRemove, onEdit }) {
  const meta = PRIORITY_META[t.priority] || PRIORITY_META.med;
  return (
    <div className="group flex items-center gap-3 bg-[#262429] border border-[#3A373D] rounded-lg px-3 py-2">
      <button
        onClick={onToggle}
        className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
        style={{ borderColor: meta.color, background: t.done ? meta.color : "transparent" }}
      >
        {t.done && <Check size={12} color="#1C1B1F" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate ${t.done ? "line-through text-[#6E7580]" : ""}`}>{t.title}</div>
        {(t.date || t.time) && (
          <div className="text-[11px] text-[#9C9791] flex gap-2 mt-0.5">
            {t.date && <span>{friendlyDate(t.date)}</span>}
            {t.time && <span>{t.time}</span>}
          </div>
        )}
      </div>
      <div className="flex gap-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 shrink-0 transition-opacity">
        <button onClick={onEdit} className="text-[#9C9791] active:text-[#D9C36A] md:hover:text-[#D9C36A] transition-colors p-1">
          <Pencil size={14} />
        </button>
        <button onClick={onRemove} className="text-[#9C9791] active:text-[#C4634F] md:hover:text-[#C4634F] transition-colors p-1">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------- Task Edit Card (AI preview + edit shared component) ----------
function TaskEditCard({ task, onConfirm, onCancel, confirmLabel = "Onayla", showClose = false }) {
  const [title, setTitle] = useState(task.title || "");
  const [date, setDate] = useState(task.date || "");
  const [time, setTime] = useState(task.time || "");
  const [priority, setPriority] = useState(task.priority || "med");

  function handleConfirm() {
    if (!title.trim()) return;
    onConfirm({ ...task, title: title.trim(), date: date || null, time: time || null, priority });
  }

  return (
    <div className="mb-5 border border-[#D9C36A] rounded-xl p-4 bg-[#262429]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-[#9C9791] tracking-wide uppercase">Görev Detayları</div>
        {showClose && (
          <button onClick={onCancel} className="text-[#6E7580] hover:text-[#EDEAE4]">
            <X size={15} />
          </button>
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Görev başlığı"
        autoFocus
        className="w-full bg-[#1C1B1F] border border-[#3A373D] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D9C36A] mb-3"
      />

      <div className="flex gap-2 mb-3">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ colorScheme: "dark" }}
          className="flex-1 bg-[#1C1B1F] border border-[#3A373D] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#D9C36A] text-[#EDEAE4]"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ colorScheme: "dark" }}
          className="flex-1 bg-[#1C1B1F] border border-[#3A373D] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#D9C36A] text-[#EDEAE4]"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {Object.entries(PRIORITY_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setPriority(key)}
            className="flex-1 py-1.5 rounded-lg text-xs border transition-colors"
            style={{
              borderColor: priority === key ? meta.color : "#3A373D",
              color: priority === key ? meta.color : "#6E7580",
              background: priority === key ? meta.color + "22" : "transparent",
            }}
          >
            {meta.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          className="flex-1 text-xs py-2 rounded-lg bg-[#D9C36A] text-[#1C1B1F] font-medium"
        >
          {confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-4 py-2 rounded-lg border border-[#3A373D] text-[#9C9791]"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="text-sm text-[#6E7580] border border-dashed border-[#3A373D] rounded-xl p-6 text-center">{text}</div>;
}

// ---------- Calendar view ----------
function CalendarView({ tasks }) {
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(todayISO());

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = {};
  tasks.forEach((t) => {
    if (!t.date) return;
    byDate[t.date] = (byDate[t.date] || []).concat(t);
  });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedTasks = byDate[selected] || [];

  return (
    <div className="px-5 pt-4 md:pt-8 max-w-2xl w-full">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="text-[#9C9791]">
          <ChevronLeft size={18} />
        </button>
        <div className="text-sm">{MONTH_NAMES[month]} {year}</div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="text-[#9C9791]">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[11px] text-[#6E7580]">
        {DAY_NAMES.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 mb-6">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const key = `${year}-${pad(month + 1)}-${pad(d)}`;
          const count = (byDate[key] || []).length;
          const isSelected = key === selected;
          const isToday = key === todayISO();
          return (
            <button
              key={i}
              onClick={() => setSelected(key)}
              className="aspect-square rounded-lg flex flex-col items-center justify-center text-xs relative"
              style={{
                background: isSelected ? "#D9C36A" : "#262429",
                color: isSelected ? "#1C1B1F" : isToday ? "#D9C36A" : "#EDEAE4",
                border: isToday && !isSelected ? "1px solid #D9C36A" : "1px solid transparent",
              }}
            >
              {d}
              {count > 0 && (
                <span
                  className="w-1 h-1 rounded-full absolute bottom-1.5"
                  style={{ background: isSelected ? "#1C1B1F" : "#D9C36A" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="text-xs uppercase tracking-wide text-[#9C9791] mb-2">{friendlyDate(selected)}</div>
      {selectedTasks.length === 0 ? (
        <EmptyState text="Bu gün için görev yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {selectedTasks.map((t) => (
            <div key={t.id} className="bg-[#262429] border border-[#3A373D] rounded-lg px-3 py-2 text-sm flex justify-between">
              <span>{t.title}</span>
              {t.time && <span className="text-[#9C9791] text-xs">{t.time}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Habits view ----------
function HabitsView({ habits, setHabits, userId, toggleHabitToday }) {
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const today = todayISO();

  async function addHabit() {
    const n = name.trim();
    if (!n) return;
    const { data, error } = await supabase
      .from("habits")
      .insert({ name: n, time: time || null, done_dates: [], user_id: userId })
      .select()
      .single();
    if (!error && data) {
      setHabits((prev) => [...prev, { id: data.id, name: data.name, doneDates: data.done_dates || [], time: data.time || null }]);
    }
    setName("");
    setTime("");
  }
  function removeHabit(id) {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    supabase.from("habits").delete().eq("id", id).then(() => {});
  }
  function streak(h) {
    let s = 0;
    let d = new Date();
    // Bugün henüz tamamlanmamışsa dünden say — gün içinde streak korunsun
    if (!h.doneDates.includes(dateKey(d))) {
      d.setDate(d.getDate() - 1);
    }
    while (h.doneDates.includes(dateKey(d))) {
      s++;
      d.setDate(d.getDate() - 1);
    }
    return s;
  }

  return (
    <div className="px-5 pt-4 md:pt-8 max-w-2xl w-full">
      <div className="flex gap-2 mb-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addHabit()}
          placeholder="Yeni alışkanlık (ör. meditasyon)"
          className="flex-1 bg-[#262429] border border-[#3A373D] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#D9C36A]"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ colorScheme: "dark" }}
          className="w-28 bg-[#262429] border border-[#3A373D] rounded-xl px-2 py-2 text-sm outline-none focus:border-[#D9C36A] text-[#EDEAE4]"
        />
        <button onClick={addHabit} className="px-3 rounded-xl bg-[#D9C36A] text-[#1C1B1F]">
          <Plus size={18} />
        </button>
      </div>
      <div className="text-[11px] text-[#6E7580] mb-5">Saat opsiyoneldir — bugün listesinde hatırlatma için.</div>
      {habits.length === 0 && <EmptyState text="Henüz alışkanlık eklenmedi." />}
      <div className="flex flex-col gap-1.5">
        {habits.map((h) => {
          const doneToday = h.doneDates.includes(today);
          return (
            <div key={h.id} className="flex items-center gap-3 bg-[#262429] border border-[#3A373D] rounded-lg px-3 py-2">
              <button
                onClick={() => toggleHabitToday(h.id)}
                className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                style={{ borderColor: "#D9C36A", background: doneToday ? "#D9C36A" : "transparent" }}
              >
                {doneToday && <Check size={12} color="#1C1B1F" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{h.name}</div>
                {h.time && <div className="text-[11px] text-[#9C9791] mt-0.5">{h.time}</div>}
              </div>
              <div className="flex items-center gap-1 text-xs text-[#D9C36A]">
                <Flame size={13} /> {streak(h)}
              </div>
              <button onClick={() => removeHabit(h.id)} className="text-[#6E7580]">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Focus (Pomodoro) view ----------
function FocusView() {
  const WORK = 25 * 60;
  const BREAK = 5 * 60;
  const [secondsLeft, setSecondsLeft] = useState(WORK);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("work");
  const [sessions, setSessions] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            const nextMode = mode === "work" ? "break" : "work";
            if (mode === "work") setSessions((n) => n + 1);
            setMode(nextMode);
            return nextMode === "work" ? WORK : BREAK;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, mode]);

  function reset() {
    setRunning(false);
    setMode("work");
    setSecondsLeft(WORK);
  }

  const mm = pad(Math.floor(secondsLeft / 60));
  const ss = pad(secondsLeft % 60);
  const total = mode === "work" ? WORK : BREAK;
  const pct = 1 - secondsLeft / total;

  return (
    <div className="px-5 pt-4 md:pt-8 max-w-2xl w-full flex flex-col items-center">
      <div className="text-xs uppercase tracking-wide text-[#9C9791] mb-6">
        {mode === "work" ? "Odak" : "Mola"} · Bugün {sessions} seans
      </div>
      <div
        className="w-48 h-48 rounded-full flex items-center justify-center mb-6 relative"
        style={{
          background: `conic-gradient(#D9C36A ${pct * 360}deg, #262429 0deg)`,
        }}
      >
        <div className="w-40 h-40 rounded-full bg-[#1C1B1F] flex items-center justify-center">
          <span className="text-3xl" style={{ fontFamily: "ui-monospace, monospace" }}>{mm}:{ss}</span>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => setRunning((r) => !r)}
          className="px-5 py-2 rounded-xl bg-[#D9C36A] text-[#1C1B1F] text-sm font-medium"
        >
          {running ? "Duraklat" : "Başlat"}
        </button>
        <button onClick={reset} className="px-5 py-2 rounded-xl border border-[#3A373D] text-[#9C9791] text-sm">
          Sıfırla
        </button>
      </div>
    </div>
  );
}
