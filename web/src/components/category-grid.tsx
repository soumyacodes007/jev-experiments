import styles from "../app/page.module.css";

const categories = [["IDENTITY", "Names, emails, phones, addresses"], ["CREDENTIAL", "Keys, passwords, tokens, secrets"], ["FINANCIAL", "Cards, accounts, payment IDs"], ["HEALTH", "Diagnoses, records, medications"], ["DIGITAL", "IPs, devices, usernames, URLs"]] as const;

export function CategoryGrid() {
  return <section className={styles.categorySection}><div className={styles.categoryIntro}><span className={styles.sectionNumber}>03</span><h2>One taxonomy.<br /><em>Everywhere it matters.</em></h2></div><div className={styles.categoryGrid}>{categories.map(([name, detail], index) => <div className={styles.categoryCard} key={name}><span>0{index + 1}</span><h3>{name}</h3><p>{detail}</p><i>↗</i></div>)}</div></section>;
}
