/** Joins the truthy class names: `cx(styles.item, done && styles.isDone)`. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
