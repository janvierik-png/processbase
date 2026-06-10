import { randomUUID } from "node:crypto";

export function createOrganizationRepository(db) {
  return {
    register({ organizationName, companyId = "", userName, email, passwordHash = "" }) {
      const organizationId = randomUUID();
      const userId = randomUUID();
      const tx = db.transaction(() => {
        db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)").run(userId, userName, email, passwordHash);
        db.prepare("INSERT INTO organizations (id, name, company_id, owner_user_id) VALUES (?, ?, ?, ?)").run(organizationId, organizationName, companyId, userId);
        db.prepare("INSERT INTO organization_members (organization_id, user_id, status) VALUES (?, ?, 'active')").run(organizationId, userId);
        db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'owner')").run(userId);
      });
      tx();
      return this.find(organizationId);
    },

    find(id) {
      return db.prepare("SELECT * FROM organizations WHERE id = ?").get(id);
    },

    update(id, patch) {
      db.prepare(`
        UPDATE organizations
        SET name = COALESCE(@name, name),
            company_id = COALESCE(@company_id, company_id),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ id, name: patch.name || null, company_id: patch.company_id || null });
      return this.find(id);
    },

    listMembers(organizationId) {
      return db.prepare(`
        SELECT users.id, users.name, users.email, users.active, organization_members.status,
               group_concat(roles.name, ', ') AS roles
        FROM organization_members
        JOIN users ON users.id = organization_members.user_id
        LEFT JOIN user_roles ON user_roles.user_id = users.id
        LEFT JOIN roles ON roles.id = user_roles.role_id
        WHERE organization_members.organization_id = ?
        GROUP BY users.id
        ORDER BY users.name
      `).all(organizationId);
    },

    invite({ organizationId, email, roleId, invitedByUserId }) {
      const invitation = {
        id: randomUUID(),
        organization_id: organizationId,
        email,
        role_id: roleId,
        invited_by_user_id: invitedByUserId,
        token: randomUUID(),
        status: "pending",
        expires_at: null
      };
      db.prepare(`
        INSERT INTO invitations (id, organization_id, email, role_id, invited_by_user_id, token, status, expires_at)
        VALUES (@id, @organization_id, @email, @role_id, @invited_by_user_id, @token, @status, @expires_at)
      `).run(invitation);
      return invitation;
    },

    listInvitations(organizationId) {
      return db.prepare("SELECT * FROM invitations WHERE organization_id = ? ORDER BY created_at DESC").all(organizationId);
    }
  };
}
