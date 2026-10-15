// Shared visual tokens (Tailwind classes) for a consistent dark theme across screens
export const ui = {
  page: "min-h-screen bg-slate-950 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 antialiased font-sans p-4 md:p-8",
  card: "bg-slate-900/70 backdrop-blur-xl border border-white/5 rounded-3xl shadow-2xl shadow-black/50 ring-1 ring-white/5",
  panel: "bg-slate-900/60 border border-white/5 rounded-2xl shadow-lg shadow-black/20",
  heading: "text-2xl md:text-3xl font-bold tracking-tight text-white",
  sectionTitle: "text-xl font-semibold tracking-tight text-slate-100",
  muted: "text-slate-400",
  input: "w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-3 text-lg text-white placeholder-slate-500 transition duration-200 hover:border-slate-600 focus:outline-none focus:ring-4 focus:ring-sky-500/20 focus:border-sky-500 disabled:opacity-50",
  label: "block text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2",
  button: "inline-flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 px-5 py-3 rounded-xl text-base font-semibold transition duration-200 active:scale-[0.98]",
  primary: "inline-flex items-center justify-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-base font-semibold transition duration-200 shadow-lg shadow-sky-900/40 active:scale-[0.98]",
  success: "inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-base font-semibold transition duration-200 shadow-lg shadow-emerald-900/40 active:scale-[0.98]",
  danger: "inline-flex items-center justify-center gap-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-base font-semibold transition duration-200 shadow-lg shadow-rose-900/40 active:scale-[0.98]",
  th: "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400",
  td: "px-4 py-3 text-slate-200",
  tableWrap: "overflow-x-auto bg-slate-900/60 border border-white/5 rounded-2xl",
  tableRow: "border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition",
};
