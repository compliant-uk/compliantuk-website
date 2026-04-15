export default function HermesDashboard() {
  return (
    <div className="min-h-screen bg-slate-950 text-cyan-400 p-8 font-mono">
      <div className="max-w-5xl mx-auto border border-cyan-900 p-8 rounded-xl bg-slate-900 shadow-[0_0_50px_rgba(6,182,212,0.1)]">
        <header className="border-b border-cyan-900 pb-6 mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-white">HERMES <span className="text-cyan-500">COCKPIT</span></h1>
            <p className="text-[10px] text-slate-500 mt-1 uppercase">Founder-Level Access Only • 2026 Statutory Silo</p>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse"></div>
              <span className="text-sm font-bold text-yellow-500 uppercase">DNS Propagating</span>
            </div>
          </div>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-center">
          <section className="lg:col-span-2 border border-slate-800 p-12 rounded-lg bg-slate-950">
             <h2 className="text-white text-xs uppercase mb-4 tracking-widest">Knowledge Ingestion</h2>
             <p className="text-slate-400 text-sm">System ready for RRA Compliance PDFs</p>
          </section>
          <aside className="bg-slate-950 border border-slate-800 p-4 rounded-lg italic text-[10px] text-slate-500 text-left">
            <p>[SYSTEM] Dashboard: Initialized</p>
            <p>[STATUS] Awaiting DNS Link...</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
