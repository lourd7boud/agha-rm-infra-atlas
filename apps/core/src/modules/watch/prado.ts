/**
 * Shared PRADO form helpers (Atexo MPE / PRADO framework, marchespublics.gov.ma).
 * A PRADO postback must replay every hidden form input verbatim — most notably
 * the ~100 KB PRADO_PAGESTATE — alongside the PRADO_POSTBACK_TARGET that names
 * the control being "clicked". Extracting the input parser here lets both the
 * stateful result pager (watch.source) and the authenticated login (portal-auth)
 * share one, tested, behaviour-identical implementation.
 */

/** Form `<input>` name→value pairs the PRADO postback must replay. */
export function parseFormInputs(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<input\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1] ?? '';
    const type = (/\btype="([^"]*)"/i.exec(tag)?.[1] ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'image' || type === 'button') continue;
    const name = /\bname="([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    // Unchecked checkboxes/radios are not submitted by a browser.
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) {
      continue;
    }
    fields[name] = /\bvalue="([^"]*)"/i.exec(tag)?.[1] ?? '';
  }
  return fields;
}
