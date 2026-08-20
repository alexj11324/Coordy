use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::signature;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct ClerkConfig {
    pub issuer: String,
    pub audience: String,
    pub authorized_parties: Vec<String>,
    pub jwks_url: String,
    pub clock_skew_seconds: i64,
    pub jwks_cache_ttl: Duration,
}

impl ClerkConfig {
    pub fn validate(&self) -> Result<(), AuthError> {
        let issuer = reqwest::Url::parse(&self.issuer)
            .map_err(|_| AuthError::Configuration("invalid Clerk issuer".into()))?;
        let jwks = reqwest::Url::parse(&self.jwks_url)
            .map_err(|_| AuthError::Configuration("invalid Clerk JWKS URL".into()))?;
        if issuer.scheme() != "https" || jwks.scheme() != "https" {
            return Err(AuthError::Configuration(
                "Clerk issuer and JWKS URL must use HTTPS".into(),
            ));
        }
        if self.audience.trim().is_empty() || self.authorized_parties.is_empty() {
            return Err(AuthError::Configuration(
                "audience and authorized parties are required".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TeamRole {
    Owner,
    Admin,
    Member,
}

impl TeamRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Member => "member",
        }
    }

    pub fn can_administer(&self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedIdentity {
    pub user_id: String,
    pub session_id: String,
    pub org_id: String,
    pub role: TeamRole,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionClaims {
    pub exp: i64,
    #[serde(default)]
    pub nbf: i64,
    pub iss: String,
    pub sub: String,
    #[serde(default)]
    pub sid: Option<String>,
    #[serde(default)]
    pub jti: Option<String>,
    pub aud: Audience,
    #[serde(default)]
    pub azp: Option<String>,
    #[serde(default)]
    pub sts: Option<String>,
    #[serde(default)]
    pub v: Option<u8>,
    #[serde(default)]
    pub o: Option<OrganizationClaims>,
    #[serde(default)]
    pub org_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, expected: &str) -> bool {
        match self {
            Self::One(value) => value == expected,
            Self::Many(values) => values.iter().any(|value| value == expected),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrganizationClaims {
    pub id: String,
    pub rol: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing bearer token")]
    Missing,
    #[error("invalid bearer token")]
    Invalid,
    #[error("session token is expired or not active yet")]
    Time,
    #[error("session is not active")]
    SessionStatus,
    #[error("active organization is required")]
    Organization,
    #[error("organization role is not supported")]
    Role,
    #[error("token issuer, audience, or authorized party is not allowed")]
    Scope,
    #[error("authentication configuration error: {0}")]
    Configuration(String),
    #[error("unable to obtain Clerk verification keys")]
    Keys,
    #[error("unable to verify Clerk organization membership")]
    MembershipUnavailable,
    #[error("user is not a member of the selected organization")]
    Membership,
}

#[derive(Clone, Debug, Deserialize)]
struct JwtHeader {
    alg: String,
    kid: String,
    #[serde(default)]
    typ: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct JwkSet {
    keys: Vec<Jwk>,
}

#[derive(Clone, Debug, Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    n: String,
    e: String,
    #[serde(default)]
    alg: Option<String>,
    #[serde(default, rename = "use")]
    key_use: Option<String>,
}

#[derive(Clone)]
struct CachedKeys {
    fetched_at: Instant,
    set: JwkSet,
}

#[derive(Clone)]
pub struct ClerkVerifier {
    config: ClerkConfig,
    client: reqwest::Client,
    cache: Arc<Mutex<Option<CachedKeys>>>,
    static_keys: Option<JwkSet>,
}

#[derive(Clone)]
pub struct ClerkMembershipVerifier {
    client: reqwest::Client,
    secret_key: Arc<str>,
    api_base: reqwest::Url,
}

#[derive(Debug, Deserialize)]
struct MembershipList {
    data: Vec<BackendMembership>,
}

#[derive(Debug, Deserialize)]
struct BackendMembership {
    role: String,
    organization: BackendOrganization,
}

#[derive(Debug, Deserialize)]
struct BackendOrganization {
    id: String,
}

impl ClerkMembershipVerifier {
    pub fn new(secret_key: String) -> Result<Self, AuthError> {
        Self::with_api_base(secret_key, "https://api.clerk.com/v1/")
    }

    fn with_api_base(secret_key: String, api_base: &str) -> Result<Self, AuthError> {
        if secret_key.trim().is_empty() {
            return Err(AuthError::Configuration(
                "Clerk backend secret is required".into(),
            ));
        }
        let api_base = reqwest::Url::parse(api_base)
            .map_err(|_| AuthError::Configuration("invalid Clerk Backend API URL".into()))?;
        if api_base.scheme() != "https" && api_base.host_str() != Some("127.0.0.1") {
            return Err(AuthError::Configuration(
                "Clerk Backend API URL must use HTTPS".into(),
            ));
        }
        Ok(Self {
            client: reqwest::Client::new(),
            secret_key: Arc::from(secret_key),
            api_base,
        })
    }

    pub async fn verify(&self, identity: VerifiedIdentity) -> Result<VerifiedIdentity, AuthError> {
        if !safe_clerk_id(&identity.user_id) || !safe_clerk_id(&identity.org_id) {
            return Err(AuthError::Invalid);
        }
        let endpoint = self
            .api_base
            .join(&format!(
                "users/{}/organization_memberships",
                identity.user_id
            ))
            .map_err(|_| AuthError::MembershipUnavailable)?;
        let response = self
            .client
            .get(endpoint)
            .bearer_auth(self.secret_key.as_ref())
            .query(&[("limit", "500")])
            .send()
            .await
            .map_err(|_| AuthError::MembershipUnavailable)?
            .error_for_status()
            .map_err(|_| AuthError::MembershipUnavailable)?;
        let list: MembershipList = response
            .json()
            .await
            .map_err(|_| AuthError::MembershipUnavailable)?;
        let membership = list
            .data
            .into_iter()
            .find(|entry| entry.organization.id == identity.org_id)
            .ok_or(AuthError::Membership)?;
        Ok(VerifiedIdentity {
            role: parse_role(&membership.role)?,
            ..identity
        })
    }
}

fn safe_clerk_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

impl ClerkVerifier {
    pub fn new(config: ClerkConfig) -> Result<Self, AuthError> {
        config.validate()?;
        Ok(Self {
            config,
            client: reqwest::Client::new(),
            cache: Arc::new(Mutex::new(None)),
            static_keys: None,
        })
    }

    #[doc(hidden)]
    pub fn with_static_jwks(config: ClerkConfig, jwks: &str) -> Result<Self, AuthError> {
        config.validate()?;
        let set = serde_json::from_str(jwks).map_err(|_| AuthError::Keys)?;
        Ok(Self {
            config,
            client: reqwest::Client::new(),
            cache: Arc::new(Mutex::new(None)),
            static_keys: Some(set),
        })
    }

    pub async fn verify_bearer(
        &self,
        authorization: Option<&str>,
    ) -> Result<VerifiedIdentity, AuthError> {
        let token = authorization
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|value| !value.is_empty())
            .ok_or(AuthError::Missing)?;
        self.verify_at(token, chrono::Utc::now().timestamp()).await
    }

    async fn verify_at(&self, token: &str, now: i64) -> Result<VerifiedIdentity, AuthError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(AuthError::Invalid);
        }
        let header: JwtHeader = decode_json(parts[0])?;
        if header.alg != "RS256"
            || header.kid.is_empty()
            || header.typ.as_deref().is_some_and(|typ| typ != "JWT")
        {
            return Err(AuthError::Invalid);
        }

        let mut keys = self.keys(false).await?;
        let mut key = keys.keys.iter().find(|key| key.kid == header.kid);
        if key.is_none() && self.static_keys.is_none() {
            keys = self.keys(true).await?;
            key = keys.keys.iter().find(|key| key.kid == header.kid);
        }
        let key = key.ok_or(AuthError::Invalid)?;
        if key.kty != "RSA"
            || key.alg.as_deref().is_some_and(|alg| alg != "RS256")
            || key.key_use.as_deref().is_some_and(|usage| usage != "sig")
        {
            return Err(AuthError::Invalid);
        }
        let modulus = URL_SAFE_NO_PAD
            .decode(&key.n)
            .map_err(|_| AuthError::Invalid)?;
        let exponent = URL_SAFE_NO_PAD
            .decode(&key.e)
            .map_err(|_| AuthError::Invalid)?;
        let signature_bytes = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| AuthError::Invalid)?;
        let signed = format!("{}.{}", parts[0], parts[1]);
        signature::RsaPublicKeyComponents {
            n: &modulus,
            e: &exponent,
        }
        .verify(
            &signature::RSA_PKCS1_2048_8192_SHA256,
            signed.as_bytes(),
            &signature_bytes,
        )
        .map_err(|_| AuthError::Invalid)?;

        let claims: SessionClaims = decode_json(parts[1])?;
        validate_claims(&self.config, claims, now)
    }

    async fn keys(&self, force: bool) -> Result<JwkSet, AuthError> {
        if let Some(set) = &self.static_keys {
            return Ok(set.clone());
        }
        if !force {
            if let Some(cached) = self.cache.lock().map_err(|_| AuthError::Keys)?.clone() {
                if cached.fetched_at.elapsed() < self.config.jwks_cache_ttl {
                    return Ok(cached.set);
                }
            }
        }
        let response = self
            .client
            .get(&self.config.jwks_url)
            .send()
            .await
            .map_err(|_| AuthError::Keys)?
            .error_for_status()
            .map_err(|_| AuthError::Keys)?;
        let set: JwkSet = response.json().await.map_err(|_| AuthError::Keys)?;
        if set.keys.is_empty() {
            return Err(AuthError::Keys);
        }
        *self.cache.lock().map_err(|_| AuthError::Keys)? = Some(CachedKeys {
            fetched_at: Instant::now(),
            set: set.clone(),
        });
        Ok(set)
    }
}

fn decode_json<T: for<'de> Deserialize<'de>>(encoded: &str) -> Result<T, AuthError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| AuthError::Invalid)?;
    serde_json::from_slice(&bytes).map_err(|_| AuthError::Invalid)
}

pub fn validate_claims(
    config: &ClerkConfig,
    claims: SessionClaims,
    now: i64,
) -> Result<VerifiedIdentity, AuthError> {
    if claims.exp.saturating_add(config.clock_skew_seconds) < now
        || claims.nbf > now.saturating_add(config.clock_skew_seconds)
    {
        return Err(AuthError::Time);
    }
    if claims.iss != config.issuer || !claims.aud.contains(&config.audience) {
        return Err(AuthError::Scope);
    }
    let is_session_v2 = claims.v == Some(2);
    if is_session_v2
        && claims
            .azp
            .as_deref()
            .is_none_or(|azp| !config.authorized_parties.iter().any(|party| party == azp))
    {
        return Err(AuthError::Scope);
    }
    if claims.sub.is_empty() || (is_session_v2 && claims.sid.as_deref().is_none_or(str::is_empty)) {
        return Err(AuthError::Invalid);
    }
    if claims
        .sts
        .as_deref()
        .is_some_and(|status| status != "active")
    {
        return Err(AuthError::SessionStatus);
    }
    let (org_id, role) = if is_session_v2 {
        let organization = claims.o.ok_or(AuthError::Organization)?;
        let role = parse_role(&organization.rol)?;
        (organization.id, role)
    } else {
        (
            claims.org_id.ok_or(AuthError::Organization)?,
            TeamRole::Member,
        )
    };
    if org_id.is_empty() {
        return Err(AuthError::Organization);
    }
    let session_id = claims
        .sid
        .or(claims.jti)
        .unwrap_or_else(|| format!("oauth:{}", claims.sub));
    Ok(VerifiedIdentity {
        user_id: claims.sub,
        session_id,
        org_id,
        role,
    })
}

pub fn parse_role(value: &str) -> Result<TeamRole, AuthError> {
    match value {
        "owner" | "org:owner" => Ok(TeamRole::Owner),
        "admin" | "org:admin" => Ok(TeamRole::Admin),
        "member" | "org:member" => Ok(TeamRole::Member),
        _ => Err(AuthError::Role),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ClerkConfig {
        ClerkConfig {
            issuer: "https://example.clerk.accounts.dev".into(),
            audience: "coordy-control-plane".into(),
            authorized_parties: vec!["http://localhost:3000".into()],
            jwks_url: "https://example.clerk.accounts.dev/.well-known/jwks.json".into(),
            clock_skew_seconds: 5,
            jwks_cache_ttl: Duration::from_secs(300),
        }
    }

    fn claims() -> SessionClaims {
        SessionClaims {
            exp: 2_000,
            nbf: 900,
            iss: config().issuer,
            sub: "user_1".into(),
            sid: Some("sess_1".into()),
            jti: None,
            aud: Audience::One("coordy-control-plane".into()),
            azp: Some("http://localhost:3000".into()),
            sts: None,
            v: Some(2),
            o: Some(OrganizationClaims {
                id: "org_1".into(),
                rol: "admin".into(),
            }),
            org_id: None,
        }
    }

    #[test]
    fn validates_v2_org_claims_and_rejects_legacy_or_unscoped_tokens() {
        let identity = validate_claims(&config(), claims(), 1_000).unwrap();
        assert_eq!(identity.org_id, "org_1");
        assert_eq!(identity.role, TeamRole::Admin);

        let mut missing_azp = claims();
        missing_azp.azp = None;
        assert!(matches!(
            validate_claims(&config(), missing_azp, 1_000),
            Err(AuthError::Scope)
        ));
        let mut missing_org = claims();
        missing_org.o = None;
        assert!(matches!(
            validate_claims(&config(), missing_org, 1_000),
            Err(AuthError::Organization)
        ));
    }

    #[test]
    fn accepts_oauth_access_claims_with_selected_organization() {
        let claims = SessionClaims {
            exp: 2_000,
            nbf: 900,
            iss: config().issuer,
            sub: "user_1".into(),
            sid: None,
            jti: Some("oauth_token_1".into()),
            aud: Audience::One("coordy-control-plane".into()),
            azp: None,
            sts: None,
            v: None,
            o: None,
            org_id: Some("org_1".into()),
        };
        let identity = validate_claims(&config(), claims, 1_000).unwrap();
        assert_eq!(identity.user_id, "user_1");
        assert_eq!(identity.org_id, "org_1");
        assert_eq!(identity.session_id, "oauth_token_1");
        // This provisional value is always replaced by the Backend API in production.
        assert_eq!(identity.role, TeamRole::Member);
    }

    #[test]
    fn rejects_time_scope_pending_and_unknown_roles() {
        let mut expired = claims();
        expired.exp = 990;
        assert!(matches!(
            validate_claims(&config(), expired, 1_000),
            Err(AuthError::Time)
        ));
        let mut pending = claims();
        pending.sts = Some("pending".into());
        assert!(matches!(
            validate_claims(&config(), pending, 1_000),
            Err(AuthError::SessionStatus)
        ));
        let mut wrong_audience = claims();
        wrong_audience.aud = Audience::One("other".into());
        assert!(matches!(
            validate_claims(&config(), wrong_audience, 1_000),
            Err(AuthError::Scope)
        ));
        let mut future = claims();
        future.nbf = 1_006;
        assert!(matches!(
            validate_claims(&config(), future, 1_000),
            Err(AuthError::Time)
        ));
        let mut wrong_issuer = claims();
        wrong_issuer.iss = "https://attacker.example".into();
        assert!(matches!(
            validate_claims(&config(), wrong_issuer, 1_000),
            Err(AuthError::Scope)
        ));
        let mut missing_session = claims();
        missing_session.sid = None;
        missing_session.jti = None;
        assert!(matches!(
            validate_claims(&config(), missing_session, 1_000),
            Err(AuthError::Invalid)
        ));
        let mut role = claims();
        role.o.as_mut().unwrap().rol = "org:unknown".into();
        assert!(matches!(
            validate_claims(&config(), role, 1_000),
            Err(AuthError::Role)
        ));
    }

    #[tokio::test]
    async fn rejects_bad_alg_and_signature_before_claim_use() {
        let verifier = ClerkVerifier::with_static_jwks(config(), r#"{"keys":[]}"#).unwrap();
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"none","kid":"x","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"user_1"}"#);
        let token = format!("{header}.{payload}.");
        assert!(matches!(
            verifier.verify_at(&token, 1_000).await,
            Err(AuthError::Invalid)
        ));
    }
}
