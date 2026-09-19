import { CategoryGrid } from "@/components/category-grid";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { RedactionDemo } from "@/components/redaction-demo";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main id="top">
        <Hero />
        <RedactionDemo />
        <section className={styles.statStrip} id="coverage">
          <div><strong>40</strong><span>sensitive types</span></div><div><strong>5</strong><span>privacy families</span></div><div><strong>0</strong><span>raw values in output</span></div><div><strong>1</strong><span>clear masked format</span></div>
        </section>
        <HowItWorks />
        <CategoryGrid />
      </main>
      <SiteFooter />
    </div>
  );
}
