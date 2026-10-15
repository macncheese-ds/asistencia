// Shared visual tokens (Tailwind classes) for a consistent dark theme across screens
export const ui = {
  page: "min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8",
  card: "bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl shadow-black/40",
  panel: "bg-slate-900 border border-slate-800 rounded-xl",
  heading: "text-2xl md:text-3xl font-semibold tracking-tight text-slate-100",
  sectionTitle: "text-xl font-semibold text-slate-200",
  muted: "text-slate-400",
  input: "w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg text-white placeholder-slate-500 transition focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500 disabled:opacity-50",
  label: "block text-base font-medium text-slate-300 mb-2",
  button: "inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 px-5 py-3 rounded-xl text-lg font-medium transition",
  primary: "inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-lg font-semibold transition shadow-lg shadow-sky-900/40",
  success: "inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-lg font-semibold transition shadow-lg shadow-emerald-900/40",
  danger: "inline-flex items-center justify-center gap-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-lg font-semibold transition shadow-lg shadow-rose-900/40",
  th: "p-3 text-left text-sm font-semibold uppercase tracking-wider text-slate-400",
  td: "p-3 text-slate-200",
  tableWrap: "overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl",
  tableRow: "border-b border-slate-800 last:border-0 hover:bg-slate-800/40",
};
