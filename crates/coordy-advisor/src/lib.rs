//! Advisors may only assess. They never commit kernel state.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct StateDiffItem {
    pub commitment: String,
    pub status: String,
    pub downstream: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct StateAssessment {
    pub status: String,
    pub suspected: bool,
    pub diffs: Vec<StateDiffItem>,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CausalAssessment {
    pub prelabel: String,
    pub reason: String,
    pub source: String,
}

pub trait Advisor: Send + Sync {
    fn assess_state_diff(
        &self,
        snapshot_claims: &[String],
        working_plan: &str,
        deterministic: &StateAssessment,
    ) -> StateAssessment;

    fn assess_causal(
        &self,
        state: &StateAssessment,
        verified_outcomes: &[String],
    ) -> Option<CausalAssessment>;
}

#[derive(Default)]
pub struct DeterministicAdvisor;

impl Advisor for DeterministicAdvisor {
    fn assess_state_diff(
        &self,
        _snapshot_claims: &[String],
        _working_plan: &str,
        deterministic: &StateAssessment,
    ) -> StateAssessment {
        let mut out = deterministic.clone();
        out.source = "deterministic".into();
        out
    }

    fn assess_causal(
        &self,
        state: &StateAssessment,
        verified_outcomes: &[String],
    ) -> Option<CausalAssessment> {
        if !state.suspected {
            return None;
        }
        if verified_outcomes.is_empty() {
            return Some(CausalAssessment {
                prelabel: "UNASSESSABLE".into(),
                reason: "no program-verified engineering outcome".into(),
                source: "deterministic".into(),
            });
        }
        Some(CausalAssessment {
            prelabel: "PRELABEL_SUSPECT".into(),
            reason: "state diff suspect with verified outcomes; not ground truth".into(),
            source: "deterministic".into(),
        })
    }
}

pub struct LlmAdvisor {
    pub enabled: bool,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    inner: DeterministicAdvisor,
}

impl LlmAdvisor {
    pub fn from_env() -> Self {
        let api_key = std::env::var("COORDY_ADVISOR_API_KEY")
            .ok()
            .filter(|v| !v.is_empty());
        let base_url = std::env::var("COORDY_ADVISOR_BASE_URL").ok();
        let enabled = std::env::var("COORDY_ADVISOR_ENABLED")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
            && api_key.is_some();
        Self {
            enabled,
            api_key,
            base_url,
            inner: DeterministicAdvisor,
        }
    }
}

impl Advisor for LlmAdvisor {
    fn assess_state_diff(
        &self,
        snapshot_claims: &[String],
        working_plan: &str,
        deterministic: &StateAssessment,
    ) -> StateAssessment {
        // LLM enrichment is optional. The deterministic DIRECT suspect remains authoritative.
        let mut assessed =
            self.inner
                .assess_state_diff(snapshot_claims, working_plan, deterministic);
        if self.enabled {
            assessed.source = "deterministic+llm-optional".into();
        }
        assessed
    }

    fn assess_causal(
        &self,
        state: &StateAssessment,
        verified_outcomes: &[String],
    ) -> Option<CausalAssessment> {
        self.inner.assess_causal(state, verified_outcomes)
    }
}
