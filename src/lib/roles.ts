// User role definitions and permission helpers

export const ROLES = ['admin', 'writer', 'reactor', 'reader'] as const;
export type Role = typeof ROLES[number];

/**
 * Role hierarchy and permissions:
 * - admin: Full access to admin panel, all features
 * - writer: Can write comments and add reactions
 * - reactor: Can only add reactions
 * - reader: Read-only access, cannot post anything
 */

export function hasRole(userRoles: string[] | null | undefined, role: Role): boolean {
	if (!userRoles) return false;
	return userRoles.includes(role);
}

export function isAdmin(userRoles: string[] | null | undefined): boolean {
	return hasRole(userRoles, 'admin');
}

export function canReact(userRoles: string[] | null | undefined): boolean {
	if (!userRoles || userRoles.length === 0) return false;
	// admin, writer, reactor can all react
	return userRoles.some(role => ['admin', 'writer', 'reactor'].includes(role));
}

export function canComment(userRoles: string[] | null | undefined): boolean {
	if (!userRoles || userRoles.length === 0) return false;
	// admin, writer can comment
	return userRoles.some(role => ['admin', 'writer'].includes(role));
}

export function getDefaultRole(): Role {
	return 'writer';
}

export function getRoleLabel(role: Role): string {
	switch (role) {
		case 'admin': return 'Admin';
		case 'writer': return 'Writer';
		case 'reactor': return 'Reactor';
		case 'reader': return 'Reader';
		default: return role;
	}
}

export function getRoleDescription(role: Role): string {
	switch (role) {
		case 'admin': return 'Full access to admin panel and all features';
		case 'writer': return 'Can write comments and add reactions';
		case 'reactor': return 'Can only add reactions';
		case 'reader': return 'Read-only access';
		default: return '';
	}
}
