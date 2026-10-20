import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  ArrowUpRight,
  ChartNoAxesColumn,
  FileCheck2,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: ChartNoAxesColumn,
    title: "Compare providers",
    description: "Evaluate models side by side on the same benchmark.",
  },
  {
    icon: RotateCcw,
    title: "Keep runs moving",
    description: "Track progress and recovery when an evaluation fails.",
  },
  {
    icon: FileCheck2,
    title: "Verify results",
    description: "Keep a verifiable receipt alongside every result.",
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col px-5 sm:px-6">
      <section
        aria-labelledby="home-title"
        className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center lg:gap-16 lg:pt-28 lg:pb-24"
      >
        <div>
          <h1
            id="home-title"
            className="max-w-4xl text-4xl leading-[1.06] font-semibold tracking-[-0.045em] text-balance sm:text-6xl xl:text-7xl"
          >
            Compare AI models with confidence.
          </h1>
          <p className="text-muted-foreground mt-7 max-w-xl text-base leading-relaxed sm:text-lg">
            Benchmark models across providers on your private datasets. Compare
            results, track every run, and keep a verifiable record.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3 border-t pt-7 sm:mt-10 sm:pt-8">
            <Button
              className="focus-visible:ring-offset-background h-12 gap-5 rounded-lg bg-[#744c70] px-6 text-sm text-white hover:bg-[#603e5d] focus-visible:ring-2 focus-visible:ring-[#744c70] focus-visible:ring-offset-2 dark:bg-[#c7a3c4] dark:text-[#211a23] dark:hover:bg-[#d6b7d3] dark:focus-visible:ring-[#c7a3c4]"
              size="lg"
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              Start benchmarking
              <ArrowUpRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        <aside className="border-l pl-6 lg:mt-14">
          <h2 className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
            Your benchmark, end to end
          </h2>
          <p className="mt-5 text-sm leading-7">
            One place to go from a private dataset to a model comparison you can
            review.
          </p>
          <ol className="text-muted-foreground mt-6 space-y-4 text-sm">
            <li className="flex gap-4">
              <span className="font-mono text-xs leading-5">01</span>
              Upload your benchmark
            </li>
            <li className="flex gap-4">
              <span className="font-mono text-xs leading-5">02</span>
              Choose your providers
            </li>
            <li className="flex gap-4">
              <span className="font-mono text-xs leading-5">03</span>
              Review results and receipts
            </li>
          </ol>
        </aside>
      </section>
      <section
        aria-label="Benchmarking features"
        className="grid border-t border-b sm:grid-cols-3"
      >
        {features.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="border-b py-7 last:border-b-0 sm:border-r sm:border-b-0 sm:px-6 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0 lg:py-9"
          >
            <Icon
              aria-hidden="true"
              className="text-muted-foreground mb-5 size-5"
            />
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-6">
              {description}
            </p>
          </div>
        ))}
      </section>
      <footer className="text-muted-foreground py-7 text-xs">
        Private by JMAC
      </footer>
    </main>
  );
}
