import styles from "../app/page.module.css";

export function SiteHeader() {
  return <header className={styles.navbar}><a className={styles.brand} href="#top" aria-label="PRISM home"><span className={styles.brandMark}>P</span><span>PRISM</span></a><nav className={styles.navLinks} aria-label="Main navigation"><a href="#demo">Live demo</a><a href="#how-it-works">How it works</a><a href="#coverage">Coverage</a></nav><a className={styles.navCta} href="#demo">Try the demo <span>↗</span></a></header>;
}
