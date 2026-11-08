/** Decorative vector ink; kept outside content and pointer interaction. */
export default function ClinicDoodle({ kind = 'loop', className = '' }) {
  const paths = {
    loop: 'M-30 190C90 250 165 100 100 75S5 210 140 210 260 80 190 45 110 125 250 95M238 72l17 24-28 11',
    paw: 'M100 147c-36-40-73-7-57 21 15 24 35 0 56 7 25 9 49 10 54-13 5-25-32-40-53-15ZM55 99c-14 6-29-23-18-32s31 22 18 32ZM90 81c-16 0-18-38-4-40s19 39 4 40ZM126 88c-16-5-5-40 9-34s7 39-9 34ZM158 113c-12-9 10-35 20-24s-9 34-20 24',
    cat: 'M21 183c15-44 13-95 20-131l40 31c23-8 42-8 65-1l37-36 10 94c1 47-30 68-72 69-33 0-63-15-68-43M80 128l8 1m52-2 8-1m-43 23 14 1-7 8-7-9m7 9v9m-15-1c10 12 22 11 32-1M48 145l-32-9m34 24-34 4m155-21 31-12m-29 28 32 2',
    care: 'M30 45v79c0 57 80 57 80 0V45M20 42h22m57 0h22M70 165v23c0 67 97 62 97 4v-37m0-34c-28 0-28 37 0 37s27-37 0-37M139 42h44m-22-22v44',
    heart: 'M12 100c-17-67 56-84 87-24 31-58 104-44 86 21-13 41-53 76-86 104-39-30-75-62-87-101m35 121c48 13 101 12 147-2',
  }
  return <svg className={`vt-doodle ${className}`} viewBox={kind === 'loop' ? '0 0 270 260' : '0 0 220 260'} fill="none" aria-hidden="true"><path d={paths[kind]} stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
