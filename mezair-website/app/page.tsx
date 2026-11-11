import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkOnView } from "@/components/marketing/mark-on-view";
import { Shot } from "@/components/marketing/shot";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { screen, type Screen } from "@/lib/screens";
import {
  desktopProviders,
  githubRepositoryUrl,
  hostedSignupNotice,
  latestDesktopDmgUrl,
  releasesUrl
} from "@/lib/site";

/** The hero reel: every supported provider, scrolling past in a window that fades at both ends. */
const reel = [...desktopProviders];

const agents = [
  { name: "Codex", plan: "Your ChatGPT plan" },
  { name: "Claude Code", plan: "Your Claude plan" },
  { name: "Cursor", plan: "Your Cursor plan" },
  { name: "Devin", plan: "Your Devin plan" }
];


function DownloadButton() {
  return (
    <Button asChild size="lg">
      <Link href={latestDesktopDmgUrl}>
        <Download aria-hidden="true" />
        Download for macOS
      </Link>
    </Button>
  );
}

/** A real capture that swaps to its focal crop below 640px, where the whole window would be unreadable. */
function ArtShot({ wide, narrow, sizes, className }: { wide: Screen; narrow: Screen; sizes: string; className?: string }) {
  const {
    props: { srcSet: narrowSrcSet, sizes: narrowSizes }
  } = getImageProps({ src: narrow.file, width: narrow.width, height: narrow.height, alt: wide.alt, sizes: "94vw" });
  const { props } = getImageProps({ src: wide.file, width: wide.width, height: wide.height, alt: wide.alt, sizes });
  return (
    <div className={`home-lit ${className ?? ""}`}>
      <picture className="shot block">
        <source
          media="(max-width: 639px)"
          srcSet={narrowSrcSet}
          sizes={narrowSizes}
          width={narrow.width}
          height={narrow.height}
        />
        <img {...props} alt={wide.alt} />
      </picture>
    </div>
  );
}

export default function HomePage() {
  const run = screen("agents-at-work");
  const narrow = screen("agents-at-work-rail");
  const picker = screen("agents-at-work-picker");
  const companion = screen("companion-home");
  const findings = screen("surface-findings");
  const findingsNarrow = screen("surface-findings-mobile");
  const factories = screen("factories-line");
  const factoriesNarrow = screen("factories-line-mobile");

  return (
    <div className="cine min-h-screen">
      <SiteHeader active="home" showThemeToggle={false} />
      <main id="main-content" className="home-main">
        <section className="home-hero cine-lit" aria-labelledby="hero-title">
          <div className="home-wide home-hero-copy">
            <h1 id="hero-title" className="home-display home-cast">
              <span className="sr-only">Codex, Claude Code, Cursor, Devin and more. </span>
              <span className="home-reel" aria-hidden="true">
                {/* Two copies, so the loop wraps without a seam. */}
                <span className="home-reel-track">
                  {[...reel, ...reel].map((name, index) => (
                    <span key={`${name}-${index}`}>{name}</span>
                  ))}
                </span>
              </span>
              <span className="home-claim">One set of reins</span>
            </h1>
            <div className="home-hero-side">
              <p className="home-byline">You connect the inference. We wrangle it.</p>
              <p className="home-body mt-3">
                The free, open-source app for running the coding agents you already pay for, side by side. Your plans, no
                markup.
              </p>
              <div className="home-hero-actions">
                <DownloadButton />
                <div className="home-hero-links">
                  <Link href={githubRepositoryUrl} className="cine-link inline-flex min-h-11 items-center">
                    Read the source
                  </Link>
                  <Link href={releasesUrl} className="cine-link inline-flex min-h-11 items-center">
                    Windows and Linux
                  </Link>
                </div>
              </div>
              <p className="cine-fine home-hero-fine">
                Sync &amp; Mesh across your machines: free to self-host, or{" "}
                <Link href="/pricing" className="cine-link">
                  £8.99 a month hosted
                </Link>
                .
              </p>
            </div>
          </div>
          <figure className="home-hero-stage">
            <div className="shot home-hero-window">
              <Image src={run.file} width={run.width} height={run.height} alt={run.alt} sizes="1100px" />
            </div>
            <div className="shot home-hero-phone">
              <Image src={narrow.file} width={narrow.width} height={narrow.height} alt={narrow.alt} sizes="94vw" />
            </div>
            <figcaption className="cine-fine home-hero-note">Real screenshots of Mezair, with sample data.</figcaption>
          </figure>
        </section>

        <section className="cine-section" aria-labelledby="switch-title">
          <div className="home-wide home-switch">
            <div className="home-switch-copy">
              <h2 id="switch-title" className="cine-h2 max-w-[16ch]">
                Switch agents, not apps.
              </h2>
              <p className="cine-lede mt-5">
                Every thread picks its own agent and model. They all work in the same repo.
              </p>
              <ul className="home-agents">
                {agents.map((agent) => (
                  <li key={agent.name}>
                    <span className="home-agent-name">{agent.name}</span>
                    <span className="home-agent-plan">{agent.plan}</span>
                  </li>
                ))}
              </ul>
              <p className="cine-fine mt-6">
                Prefer an API key? Bring your own. Your provider bills you; Mezair adds nothing.
              </p>
            </div>
            <div className="home-lit home-picker">
              <div className="shot">
                <Image
                  src={picker.file}
                  width={picker.width}
                  height={picker.height}
                  alt={picker.alt}
                  sizes="(min-width: 640px) 372px, 94vw"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="cine-section" aria-labelledby="away-title">
          <div className="home-wide home-interlude">
            <h2 id="away-title" className="home-display home-interlude-title">
              <span className="home-dim">Set them off.</span>
              <span>Walk away.</span>
            </h2>
            <div className="home-away">
              <div className="home-lit home-phone">
                <div className="home-phone-screen">
                  <Image
                    src={companion.file}
                    width={companion.width}
                    height={companion.height}
                    alt={companion.alt}
                    sizes="(min-width: 1024px) 18rem, 70vw"
                  />
                </div>
              </div>
              <p className="home-body">
                Background work gets its own worktree, so agents stay out of each other&rsquo;s way and out of your
                checkout. When one needs you, answer from your iPhone or your watch.
              </p>
            </div>
          </div>
        </section>

        <section className="cine-section home-bleed-section" aria-labelledby="receipts-title">
          <div className="home-bleed">
            <div className="home-bleed-copy">
              <h2 id="receipts-title" className="cine-h2 max-w-[14ch]">
                The receipts are in the thread.
              </h2>
              <p className="cine-lede mt-5">
                Findings land in the thread that caused them, with the file and line. Ask the agent to fix them, or undo the
                turn.
              </p>
            </div>
            <ArtShot
              wide={findings}
              narrow={findingsNarrow}
              sizes="(min-width: 1024px) 60vw, 94vw"
              className="home-bleed-shot"
            />
          </div>
        </section>

        <section className="cine-section" aria-labelledby="factories-title">
          <div className="home-wide">
            <div className="cine-titlerow">
              <h2 id="factories-title" className="cine-h2 max-w-[17ch]">
                Label an issue. Come back to a pull request.
                <span className="home-factory-aside">Or let the agent merge it when it&rsquo;s ready.</span>
              </h2>
              <div>
                <p className="cine-lede">
                  Software factories carry a labelled GitHub issue all the way to a reviewed pull request. By default
                  nothing merges until you approve it; switch a factory to auto-merge and it lands without you.
                </p>
                <p className="home-factory-link">
                  <Link href="/docs/desktop/software-factories" className="cine-link inline-flex min-h-11 items-center">
                    How factories work
                  </Link>{" "}
                  <span className="text-muted-foreground">In beta.</span>
                </p>
              </div>
            </div>
            <ArtShot
              wide={factories}
              narrow={factoriesNarrow}
              sizes="(min-width: 1440px) 1248px, 94vw"
              className="home-full-shot"
            />
          </div>
        </section>

        <section className="cine-section cine-lit" aria-labelledby="machines-title">
          <div className="home-wide home-split">
            <div>
              <h2 id="machines-title" className="cine-h2 max-w-[14ch]">
                Your other machines can work too.
              </h2>
              <p className="cine-lede mt-5">
                Sync keeps your setup identical everywhere, end-to-end encrypted. Mesh sends a job to the Mac in the office or
                the Linux box under your desk and streams it back.
              </p>
              <div className="home-machine-actions">
                <Button asChild variant="outline">
                  <Link href="/sync">How Sync &amp; Mesh work</Link>
                </Button>
                <Link href="/pricing" className="cine-link inline-flex min-h-11 items-center">
                  Pricing
                </Link>
              </div>
            </div>
            <Shot id="mesh-jobs" caption={false} className="home-mesh" sizes="(min-width: 1024px) 576px, 94vw" />
          </div>
        </section>

        <section className="cine-section" aria-labelledby="yours-title">
          <div className="home-wide">
            <h2 id="yours-title" className="cine-h2 max-w-[18ch]">
              Free and open source. Pay us only to host.
            </h2>
            <div className="home-offer">
              <div className="home-offer-plan">
                <p className="home-offer-name">Mezair Desktop</p>
                <p className="home-offer-price">Free</p>
                <ul className="home-offer-points">
                  <li>Every feature, MIT licensed. Fork it.</li>
                  <li>Your agents run on the plans you already have, at no markup.</li>
                  <li>No account. Threads stay in a database on your Mac.</li>
                </ul>
                <div className="home-offer-actions">
                  <DownloadButton />
                  <Link href={githubRepositoryUrl} className="cine-link inline-flex min-h-11 items-center">
                    Read the source
                  </Link>
                </div>
              </div>
              <div className="home-offer-plan home-offer-plan--hosted">
                <p className="home-offer-name">Hosted Sync &amp; Mesh</p>
                <p className="home-offer-price">
                  £8.99<span> a month</span>
                </p>
                <ul className="home-offer-points">
                  <li>We run the backend that keeps your machines in step and sends jobs between them.</li>
                  <li>End-to-end encrypted, with the same open-source backend you could run yourself.</li>
                  <li>Teams £12 a member. Or self-host it free on your own Cloudflare account.</li>
                </ul>
                <div className="home-offer-actions">
                  <Button asChild size="lg" variant="outline">
                    <Link href="/waitlist">Request beta access</Link>
                  </Button>
                  <Link href="/docs/sync/self-deploy" className="cine-link inline-flex min-h-11 items-center">
                    Self-host it
                  </Link>
                </div>
                <p className="cine-fine home-offer-note">{hostedSignupNotice}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="cine-section cine-lit" aria-labelledby="close-title">
          <div className="home-wide home-close">
            <MarkOnView className="hero-mark text-foreground" />
            <h2 id="close-title" className="home-display home-close-title">
              Take the reins.
            </h2>
            <div className="home-close-actions">
              <DownloadButton />
              <Button asChild size="lg" variant="outline">
                <Link href="/docs/desktop/installation">Read the install guide</Link>
              </Button>
            </div>
            <p className="cine-fine mt-5">Free. No sign-up.</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
