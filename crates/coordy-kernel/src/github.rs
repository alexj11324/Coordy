//! Product rules for linking GitHub pull requests to Coordy issues.
//!
//! Matching is identifier-based, not GitHub-App-based. A working link is created
//! when the workspace issue prefix appears in the PR branch or title, or when the
//! body uses a GitHub close-intent immediately followed by that identifier.

use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IssueLink {
    pub identifier: String,
    pub close_intent: bool,
}

pub fn issue_links(prefix: &str, branch: &str, title: &str, body: &str) -> Vec<IssueLink> {
    let prefix = prefix.trim();
    if prefix.is_empty() {
        return Vec::new();
    }
    let prefix_up = prefix.to_ascii_uppercase();
    let mut found: BTreeMap<String, bool> = BTreeMap::new();
    for hay in [branch, title] {
        for ident in find_idents(&prefix_up, hay) {
            found.entry(ident).or_insert(false);
        }
    }
    let body_up = body.to_ascii_uppercase();
    for ident in find_idents(&prefix_up, body) {
        if close_intent_before(&body_up, &ident) {
            found.insert(ident, true);
        }
    }
    found
        .into_iter()
        .map(|(identifier, close_intent)| IssueLink {
            identifier,
            close_intent,
        })
        .collect()
}

pub fn is_working_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

pub fn is_merged_state(state: &str) -> bool {
    state == "merged"
}

fn find_idents(prefix_up: &str, hay: &str) -> Vec<String> {
    let hay_up = hay.to_ascii_uppercase();
    let bytes = hay_up.as_bytes();
    let prefix = prefix_up.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + prefix.len() + 2 <= bytes.len() {
        let boundary_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        if boundary_ok
            && bytes[i..].starts_with(prefix)
            && bytes.get(i + prefix.len()) == Some(&b'-')
        {
            let mut j = i + prefix.len() + 1;
            let num_start = j;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > num_start {
                out.push(format!("{}-{}", prefix_up, &hay_up[num_start..j]));
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn close_intent_before(hay_up: &str, ident: &str) -> bool {
    let mut from = 0;
    while let Some(rel) = hay_up[from..].find(ident) {
        let pos = from + rel;
        if has_close_verb_before(hay_up, pos) {
            return true;
        }
        from = pos + ident.len();
    }
    false
}

fn has_close_verb_before(hay_up: &str, ident_pos: usize) -> bool {
    let before = &hay_up[..ident_pos];
    let without_ws = before.trim_end_matches(|c: char| c.is_ascii_whitespace());
    if without_ws.len() == before.len() {
        return false;
    }
    let verb_start = without_ws
        .rfind(|c: char| !c.is_ascii_alphabetic())
        .map(|i| i + 1)
        .unwrap_or(0);
    is_close_verb(&without_ws[verb_start..])
}

fn is_close_verb(word: &str) -> bool {
    matches!(
        word,
        "CLOSE"
            | "CLOSES"
            | "CLOSED"
            | "FIX"
            | "FIXES"
            | "FIXED"
            | "RESOLVE"
            | "RESOLVES"
            | "RESOLVED"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_and_title_create_working_links() {
        let links = issue_links(
            "COOR",
            "coor-12-fix-login",
            "COOR-12 Fix the redirect",
            "see notes",
        );
        assert_eq!(
            links,
            vec![IssueLink {
                identifier: "COOR-12".into(),
                close_intent: false,
            }]
        );
    }

    #[test]
    fn related_to_in_body_is_ignored() {
        let links = issue_links("COOR", "main", "unrelated", "Related to COOR-3");
        assert!(links.is_empty());
    }

    #[test]
    fn close_intent_requires_immediate_identifier() {
        let closes = issue_links("COOR", "feat", "n", "Closes COOR-7\nFixes COOR-8");
        assert_eq!(
            closes,
            vec![
                IssueLink {
                    identifier: "COOR-7".into(),
                    close_intent: true,
                },
                IssueLink {
                    identifier: "COOR-8".into(),
                    close_intent: true,
                },
            ]
        );
        let skipped = issue_links("COOR", "feat", "n", "Closes login COOR-7");
        assert!(skipped.is_empty());
    }

    #[test]
    fn close_intent_or_with_title_match() {
        let links = issue_links("COOR", "x", "COOR-1 login", "Resolves COOR-1");
        assert_eq!(
            links,
            vec![IssueLink {
                identifier: "COOR-1".into(),
                close_intent: true,
            }]
        );
    }
}
