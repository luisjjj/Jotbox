import { StaticBars } from "./Waveform";

export function NotePreview() {
  return (
    <div className="relative h-full">
      <div className="absolute right-0 top-1/2 w-[300px] -translate-y-1/2">
        <div className="rotate-[1.8deg] rounded-xl bg-[#fbf8f0] p-4 text-[#20231e] shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between border-b border-[#e9e3d4] pb-2">
            <span className="text-[11.5px] font-semibold tracking-[-0.01em]">Payout review</span>
            <span className="rounded-full bg-[#eaf0e9] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#46654f]">
              Meeting
            </span>
          </div>
          <p className="mt-2.5 text-[7.5px] font-semibold uppercase tracking-[0.16em] text-[#a09a8b]">Summary</p>
          <p className="mt-1 text-[9.5px] leading-[1.55] text-[#4c5048]">
            Friday's card volume is partly unsettled and the bank window missed the same-day promise. The group pauses
            that promise until the cutoff holds.
          </p>
          <p className="mt-2.5 text-[7.5px] font-semibold uppercase tracking-[0.16em] text-[#a09a8b]">Actions</p>
          <div className="mt-1 space-y-1">
            {["Send the merchant note before 4pm", "Re-pull the two failed batches"].map((line) => (
              <div key={line} className="flex items-start gap-1.5">
                <span className="mt-[2px] grid h-2.5 w-2.5 flex-none place-items-center rounded-[3px] border border-[#c9c4b4] bg-white" />
                <span className="text-[8.5px] leading-[1.5] text-[#5c5f55]">{line}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[#ece6d8] pt-2">
            <StaticBars
              className="h-4 w-14 text-[#3f7a5e]"
              heights={[0.4, 0.7, 1, 0.5, 0.8, 0.3, 0.65, 0.9, 0.45]}
            />
            <span className="text-[7.5px] uppercase tracking-[0.12em] text-[#a09a8b]">Written by JotBox</span>
          </div>
        </div>

        <div className="absolute -bottom-8 -left-6 flex items-center gap-2 rounded-full bg-[#0c261f] px-3 py-1.5 text-[9.5px] font-medium text-[#ece8da] shadow-lg ring-1 ring-white/10">
          <span className="live-dot" />
          Recording · 18:42
        </div>
      </div>
    </div>
  );
}
