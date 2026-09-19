import styles from "../app/page.module.css";

export function SiteFooter() {
  return <footer className={styles.footer}><a className={styles.brand} href="#top"><span className={styles.brandMark}>P</span><span>PRISM</span></a><span>Semantic detection. Deterministic masking.</span><span>© 2026 PRISM</span></footer>;
}
