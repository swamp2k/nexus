import { useEffect, useState } from "react";

type UserRole = "admin" | "member" | "viewer";
type UserStatus = "active" | "invited" | "disabled";
type NexusUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
};
type UsersResponse = { users: NexusUser[]; currentUserId: string };

type Feedback = { kind: "success" | "error"; text: string } | null;

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  member: "Medlem",
  viewer: "Kun visning",
};
const statusLabels: Record<UserStatus, string> = {
  active: "Aktiv",
  invited: "Inviteret",
  disabled: "Deaktiveret",
};

async function responseError(response: Response): Promise<string> {
  let code = `HTTP ${response.status}`;
  try {
    const body = await response.json() as { error?: string };
    code = body.error ?? code;
  } catch { /* ignore */ }
  const labels: Record<string, string> = {
    email_already_exists: "Mailadressen er allerede i brug.",
    invalid_email: "Mailadressen er ikke gyldig.",
    invalid_display_name: "Navnet er ikke gyldigt.",
    last_admin: "Den sidste aktive admin kan ikke fjernes eller deaktiveres.",
    cannot_disable_self: "Du kan ikke deaktivere din egen bruger.",
    cannot_delete_self: "Du kan ikke slette din egen bruger.",
    invite_send_failed: "Brugeren blev ikke oprettet, fordi invitationen ikke kunne sendes.",
    forbidden: "Kun administratorer kan administrere brugere.",
  };
  return labels[code] ?? code;
}

export default function UsersSettings() {
  const [users, setUsers] = useState<NexusUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("member");
  const [inviting, setInviting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/users", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as UsersResponse;
      setUsers(data.users);
      setCurrentUserId(data.currentUserId);
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Kunne ikke hente brugere." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: inviteName, email: inviteEmail, role: inviteRole }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setInviteName("");
      setInviteEmail("");
      setInviteRole("member");
      setFeedback({ kind: "success", text: "Invitationen er sendt." });
      await load();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Invitationen kunne ikke sendes." });
    } finally {
      setInviting(false);
    }
  }

  function updateLocal(id: string, changes: Partial<NexusUser>) {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...changes } : user));
  }

  async function saveUser(user: NexusUser) {
    setBusyId(user.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: user.displayName ?? "", email: user.email, role: user.role, status: user.status }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setFeedback({ kind: "success", text: `${user.displayName || user.email} er gemt.` });
      await load();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Brugeren kunne ikke gemmes." });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function resend(user: NexusUser) {
    setBusyId(user.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}/resend-invite`, {
        method: "POST", credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setFeedback({ kind: "success", text: `Invitationen er sendt igen til ${user.email}.` });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Invitationen kunne ikke sendes." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(user: NexusUser) {
    if (!window.confirm(`Slet ${user.displayName || user.email}? Dette kan ikke fortrydes.`)) return;
    setBusyId(user.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE", credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setFeedback({ kind: "success", text: "Brugeren er slettet." });
      await load();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Brugeren kunne ikke slettes." });
    } finally {
      setBusyId(null);
    }
  }

  return <div className="settings-form users-settings">
    <form className="user-invite-form" onSubmit={(event) => void invite(event)}>
      <div className="settings-coordinate-grid">
        <label><span>Navn</span><input value={inviteName} onChange={(event) => setInviteName(event.target.value)} maxLength={100} placeholder="Aksel" /></label>
        <label><span>Mail</span><input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="navn@example.com" /></label>
      </div>
      <label><span>Rolle</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)}><option value="member">Medlem</option><option value="viewer">Kun visning</option><option value="admin">Admin</option></select></label>
      <div className="settings-location-actions"><button className="primary-action" type="submit" disabled={inviting || !inviteEmail}>{inviting ? "Sender…" : "Inviter bruger"}</button><span>Invitationen er gyldig i 24 timer.</span></div>
    </form>

    {feedback && <p className={`settings-feedback ${feedback.kind}`}>{feedback.text}</p>}
    {loading ? <p className="settings-loading">Henter brugere…</p> : <div className="users-list">
      {users.map((user) => <article className="user-row" key={user.id}>
        <div className="user-row-header"><div><strong>{user.displayName || user.email}</strong><span className={`user-status ${user.status}`}>{statusLabels[user.status]}</span></div>{user.id === currentUserId && <small>Dig</small>}</div>
        <div className="settings-coordinate-grid">
          <label><span>Navn</span><input value={user.displayName ?? ""} onChange={(event) => updateLocal(user.id, { displayName: event.target.value })} /></label>
          <label><span>Mail</span><input type="email" value={user.email} onChange={(event) => updateLocal(user.id, { email: event.target.value })} /></label>
          <label><span>Rolle</span><select value={user.role} onChange={(event) => updateLocal(user.id, { role: event.target.value as UserRole })}><option value="admin">Admin</option><option value="member">Medlem</option><option value="viewer">Kun visning</option></select></label>
          <label><span>Status</span><select value={user.status} disabled={user.id === currentUserId} onChange={(event) => updateLocal(user.id, { status: event.target.value as UserStatus })}><option value="active">Aktiv</option><option value="disabled">Deaktiveret</option>{user.status === "invited" && <option value="invited">Inviteret</option>}</select></label>
        </div>
        <div className="user-row-actions">
          <button type="button" className="secondary-action" disabled={busyId === user.id} onClick={() => void saveUser(user)}>Gem</button>
          {user.status === "invited" && <button type="button" className="secondary-action" disabled={busyId === user.id} onClick={() => void resend(user)}>Send invitation igen</button>}
          <button type="button" className="danger-action" disabled={busyId === user.id || user.id === currentUserId} onClick={() => void remove(user)}>Slet</button>
        </div>
      </article>)}
    </div>}
  </div>;
}
