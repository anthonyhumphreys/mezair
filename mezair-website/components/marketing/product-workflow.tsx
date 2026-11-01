import Image from "next/image";
import Link from "next/link";
import { screen } from "@/lib/screens";

const steps = [
  { title: "Describe the task", body: "Raise the retry limit to five. Keep the backoff. Add a regression test." },
  { title: "Let the agent work", body: "It reads the code, reproduces the failure, makes the edit and runs the tests." },
  { title: "Review the change", body: "Read the result, inspect the diff and ask for any fixes in the same thread." }
];

/** One real, complete workflow; a narrow capture keeps the same example legible on phones. */
export function ProductWorkflow() {
  const desktop = screen("retry-workflow");
  const mobile = screen("retry-workflow-mobile");
  return (
    <div className="product-workflow">
      <ol className="workflow-steps" aria-label="From request to reviewed change">
        {steps.map((step) => (
          <li key={step.title}>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <figure>
        <div className="shot workflow-shot">
          <picture>
            <source media="(max-width: 639px)" srcSet={mobile.file} width={mobile.width} height={mobile.height} />
            <Image src={desktop.file} width={desktop.width} height={desktop.height} alt={desktop.alt} sizes="(min-width: 1200px) 1100px, 94vw" />
          </picture>
        </div>
        <figcaption className="workflow-caption">
          <span>An example retry fix, test results and review in one thread.</span>
          <Link href="/docs/desktop/agent-workflows" className="cine-link">Explore agent workflows</Link>
        </figcaption>
      </figure>
    </div>
  );
}
