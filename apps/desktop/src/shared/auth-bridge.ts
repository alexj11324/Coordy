export type AuthStatus =
  | "config-missing"
  | "config-error"
  | "loading"
  | "signed-out"
  | "signed-in";

export type SanitizedAuthState = {
  status: AuthStatus;
  identity: {
    id: string;
    name: string;
    email: string | null;
    imageUrl: string | null;
  } | null;
  organization: {
    id: string;
    name: string;
    imageUrl: string | null;
  } | null;
};

export type AuthSurface =
  | "sign-in"
  | "profile"
  | "create-organization"
  | "manage-organization"
  | "organization-list";

export type AuthWindowCommand = AuthSurface | "sign-out";
