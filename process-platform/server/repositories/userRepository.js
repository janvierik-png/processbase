export function createUserRepository(db) {
  return {
    listUsers() {
      return db.prepare(`
        SELECT users.id, users.name, users.email, users.active, group_concat(roles.name, ', ') AS roles
        FROM users
        LEFT JOIN user_roles ON user_roles.user_id = users.id
        LEFT JOIN roles ON roles.id = user_roles.role_id
        GROUP BY users.id
        ORDER BY users.name
      `).all();
    },

    listRoles() {
      return db.prepare("SELECT * FROM roles ORDER BY name").all().map((role) => ({
        ...role,
        permissions: JSON.parse(role.permissions_json)
      }));
    }
  };
}
