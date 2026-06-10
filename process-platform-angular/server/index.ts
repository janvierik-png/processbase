import 'dotenv/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import {
  InvitationStatus,
  OrganizationRole,
  ProcessNodeType,
  ProcessStatus
} from '../generated/prisma/client';
import { prisma } from './prisma';

const app = express();
const port = Number(process.env['API_PORT'] ?? 3000);
const host = process.env['API_HOST'] ?? '0.0.0.0';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '15mb' }));

type ProcessTreeNode = {
  id: string;
  name: string;
  type: 'folder' | 'process';
  children?: ProcessTreeNode[];
  owner?: string;
  status?: string;
  revision?: string;
  purpose?: string;
  risks?: string;
  bpmnXml?: string;
  diagramSvg?: string;
  iso?: Array<{ standard: string; clause: string; evidence: string }>;
  revisions?: Array<{ id: string; name: string; date: string; bpmnXml: string; diagramSvg?: string }>;
  attachments?: unknown[];
  approvals?: unknown[];
  history?: string[];
};

function mapAttachment(attachment: any) {
  return {
    id: attachment.id,
    name: attachment.fileName,
    type: attachment.mimeType,
    owner: attachment.uploadedBy?.name ?? '',
    size: attachment.sizeBytes,
    createdAt: attachment.createdAt.toISOString().slice(0, 10),
    dataUrl: attachment.storagePath,
    processId: attachment.processNodeId ?? undefined,
    processName: attachment.processNode?.name ?? undefined
  };
}

function emptyBpmnXml(id: string, name: string): string {
  const escapedName = escapeXml(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_${id}" targetNamespace="https://processbase.local/bpmn">
  <bpmn:process id="Process_${id}" name="${escapedName}" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_${id}">
    <bpmndi:BPMNPlane id="BPMNPlane_${id}" bpmnElement="Process_${id}" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    const replacements: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;'
    };
    return replacements[char] ?? char;
  });
}

async function ensureOrganization(organizationId: string) {
  const existing = await prisma.organization.findFirst({
    where: {
      OR: [
        { id: organizationId },
        { slug: organizationId }
      ]
    }
  });
  if (existing) return existing;

  const slugBase = organizationId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organizacia';
  return prisma.organization.create({
    data: {
      id: organizationId,
      name: 'Organizacia',
      slug: `${slugBase}-${Date.now()}`
    }
  });
}

function mapNode(node: any): ProcessTreeNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type === ProcessNodeType.GROUP ? 'folder' : 'process',
    owner: node.owner?.name ?? '',
    status: mapStatusFromDb(node.status),
    revision: node.revisions?.[0]?.createdAt?.toISOString().slice(0, 10) ?? node.updatedAt?.toISOString().slice(0, 10),
    purpose: node.description ?? '',
    risks: '',
    bpmnXml: node.bpmnXml ?? undefined,
    iso: (node.isoLinks ?? []).map((link: string) => {
      const [standard, clause = ''] = link.split(':');
      return { standard, clause, evidence: '' };
    }),
    revisions: (node.revisions ?? []).map((revision: any) => ({
      id: revision.id,
      name: revision.name,
      date: revision.createdAt.toISOString().slice(0, 10),
      bpmnXml: revision.bpmnXml,
      diagramSvg: revision.diagramSvg ?? undefined
    })),
    attachments: [],
    approvals: [],
    history: [],
    children: (node.children ?? []).sort((a: any, b: any) => a.sortOrder - b.sortOrder).map(mapNode)
  };
}

function buildProcessTree(nodes: any[]): ProcessTreeNode[] {
  const mapped = new Map<string, any>();
  const roots: any[] = [];

  for (const node of nodes) {
    mapped.set(node.id, { ...node, children: [] });
  }

  for (const node of mapped.values()) {
    if (node.parentId && mapped.has(node.parentId)) {
      mapped.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots.sort((a, b) => a.sortOrder - b.sortOrder).map(mapNode);
}

function mapStatusToDb(status?: string): ProcessStatus {
  const normalized = (status ?? '').toLowerCase();
  if (normalized.includes('schval')) return ProcessStatus.APPROVED;
  if (normalized.includes('review') || normalized.includes('kontrol')) return ProcessStatus.IN_REVIEW;
  if (normalized.includes('arch')) return ProcessStatus.ARCHIVED;
  return ProcessStatus.DRAFT;
}

function mapStatusFromDb(status: ProcessStatus): string {
  if (status === ProcessStatus.APPROVED) return 'Schvalene';
  if (status === ProcessStatus.IN_REVIEW) return 'Na schvalenie';
  if (status === ProcessStatus.ARCHIVED) return 'Archiv';
  return 'Navrh';
}

function isoLinksFromBody(iso: unknown): string[] {
  if (!Array.isArray(iso)) return [];
  return iso.map((item: any) => `${item.standard ?? ''}:${item.clause ?? ''}`.replace(/:$/, '')).filter(Boolean);
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/organizations/:organizationId/processes', async (request, response, next) => {
  try {
    const { organizationId } = request.params;
    const organization = await ensureOrganization(organizationId);
    const nodes = await prisma.processNode.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        owner: true,
        revisions: { orderBy: { createdAt: 'desc' } }
      }
    });
    response.json(buildProcessTree(nodes));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/processes', async (request, response, next) => {
  try {
    const { organizationId } = request.params;
    const organization = await ensureOrganization(organizationId);
    const type = request.body.type === 'folder' ? ProcessNodeType.GROUP : ProcessNodeType.PROCESS;
    const name = request.body.name ?? (type === ProcessNodeType.GROUP ? 'Nova skupina' : 'Novy proces');
    const processNode = await prisma.processNode.create({
      data: {
        organizationId: organization.id,
        parentId: request.body.parentId || null,
        type,
        name,
        description: request.body.purpose ?? null,
        status: mapStatusToDb(request.body.status),
        sortOrder: Number(request.body.sortOrder ?? 0),
        bpmnXml: type === ProcessNodeType.PROCESS ? emptyBpmnXml(`process_${Date.now()}`, name) : null,
        isoLinks: isoLinksFromBody(request.body.iso)
      },
      include: { owner: true, revisions: true, children: true }
    });
    response.status(201).json(mapNode(processNode));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/processes/:processId', async (request, response, next) => {
  try {
    const { processId } = request.params;
    const current = await prisma.processNode.findUnique({ where: { id: processId } });
    if (!current) {
      response.status(404).json({ message: 'Process not found' });
      return;
    }
    const updated = await prisma.processNode.update({
      where: { id: processId },
      data: {
        name: request.body.name ?? undefined,
        description: request.body.purpose ?? undefined,
        status: request.body.status ? mapStatusToDb(request.body.status) : undefined,
        bpmnXml: request.body.bpmnXml ?? undefined,
        isoLinks: request.body.iso ? isoLinksFromBody(request.body.iso) : undefined,
        parentId: request.body.parentId === undefined ? undefined : request.body.parentId,
        sortOrder: request.body.sortOrder === undefined ? undefined : Number(request.body.sortOrder)
      },
      include: { owner: true, revisions: { orderBy: { createdAt: 'desc' } }, children: true }
    });
    response.json(mapNode(updated));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/processes/:processId', async (request, response, next) => {
  try {
    const { processId } = request.params;
    await prisma.processNode.delete({ where: { id: processId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/documents', async (request, response, next) => {
  try {
    const organization = await ensureOrganization(request.params.organizationId);
    const attachments = await prisma.attachment.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'desc' },
      include: { processNode: true, uploadedBy: true }
    });
    response.json(attachments.map(mapAttachment));
  } catch (error) {
    next(error);
  }
});

app.get('/api/processes/:processId/documents', async (request, response, next) => {
  try {
    const attachments = await prisma.attachment.findMany({
      where: { processNodeId: request.params.processId },
      orderBy: { createdAt: 'desc' },
      include: { processNode: true, uploadedBy: true }
    });
    response.json(attachments.map(mapAttachment));
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/documents', async (request, response, next) => {
  try {
    const processNode = await prisma.processNode.findUnique({ where: { id: request.params.processId } });
    if (!processNode) {
      response.status(404).json({ message: 'Process not found' });
      return;
    }
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: processNode.organizationId,
        processNodeId: processNode.id,
        fileName: request.body.fileName,
        mimeType: request.body.mimeType ?? 'application/octet-stream',
        sizeBytes: Number(request.body.sizeBytes ?? 0),
        storagePath: request.body.dataUrl ?? ''
      },
      include: { processNode: true, uploadedBy: true }
    });
    response.status(201).json(mapAttachment(attachment));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/documents/:documentId', async (request, response, next) => {
  try {
    await prisma.attachment.delete({ where: { id: request.params.documentId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/revisions', async (request, response, next) => {
  try {
    const { processId } = request.params;
    const processNode = await prisma.processNode.findUnique({ where: { id: processId } });
    if (!processNode || !processNode.bpmnXml) {
      response.status(404).json({ message: 'Process with BPMN XML not found' });
      return;
    }
    const revision = await prisma.processRevision.create({
      data: {
        processNodeId: processId,
        name: request.body.name || `Verzia ${new Date().toISOString().slice(0, 10)}`,
        note: request.body.note ?? null,
        bpmnXml: request.body.bpmnXml ?? processNode.bpmnXml,
        diagramSvg: request.body.diagramSvg ?? null,
        documentation: request.body.documentation ?? undefined
      }
    });
    response.status(201).json({
      id: revision.id,
      name: revision.name,
      date: revision.createdAt.toISOString().slice(0, 10),
      bpmnXml: revision.bpmnXml,
      diagramSvg: revision.diagramSvg
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/processes/:processId/camunda7/deploy', async (request, response, next) => {
  try {
    response.json(await deployProcessToCamunda(request.params.processId, request.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/camunda7/deploy', async (request, response, next) => {
  try {
    response.json(await deployProcessToCamunda(request.body.processId, request.body));
  } catch (error) {
    next(error);
  }
});

async function deployProcessToCamunda(processId: string, body: any) {
  const processNode = await prisma.processNode.findUnique({
    where: { id: processId },
    include: { organization: true }
  });
  if (!processNode || processNode.type !== ProcessNodeType.PROCESS) {
    throw new HttpError(404, 'Process not found');
  }

  const bpmnXml = body.bpmnXml ?? processNode.bpmnXml;
  if (!bpmnXml) {
    throw new HttpError(400, 'Process has no BPMN XML to deploy');
  }

  const baseUrl = process.env['CAMUNDA7_BASE_URL'] || processNode.organization.camundaBaseUrl;
  if (!baseUrl) {
    throw new HttpError(400, 'CAMUNDA7_BASE_URL is not configured');
  }

  const deploymentName = body.deploymentName || processNode.name;
  const resourceName = body.resourceName || `${processNode.name.replace(/[^a-z0-9_-]+/gi, '_')}.bpmn`;
  const deployment = await deployToCamunda7({
    baseUrl,
    deploymentName,
    resourceName,
    bpmnXml,
    deployChangedOnly: body.deployChangedOnly !== false
  });
  const deployedDefinition = Object.values((deployment.deployedProcessDefinitions ?? {}) as Record<string, any>)[0];
  const processKey = deployedDefinition?.key ?? processNode.camundaProcessKey ?? processNode.id;

  await prisma.processNode.update({
    where: { id: processId },
    data: {
      bpmnXml,
      camundaProcessKey: processKey
    }
  });

  await prisma.camundaDeployment.create({
    data: {
      organizationId: processNode.organizationId,
      processNodeId: processId,
      deploymentId: deployment.id,
      processKey,
      response: deployment
    }
  });

  return deployment;
}

async function deployToCamunda7(options: {
  baseUrl: string;
  deploymentName: string;
  resourceName: string;
  bpmnXml: string;
  deployChangedOnly: boolean;
}) {
  const formData = new FormData();
  formData.set('deployment-name', options.deploymentName);
  formData.set('deploy-changed-only', String(options.deployChangedOnly));
  formData.set('enable-duplicate-filtering', 'true');
  formData.set('deployment-source', 'process-platform-angular');
  formData.set('data', new Blob([options.bpmnXml], { type: 'application/xml' }), options.resourceName);

  const headers: HeadersInit = {};
  const username = process.env['CAMUNDA7_USERNAME'];
  const password = process.env['CAMUNDA7_PASSWORD'];
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/deployment/create`, {
    method: 'POST',
    headers,
    body: formData
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Camunda 7 deploy failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// --- Auth, organizacie a pozvanky ---

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Frontend roly (RoleId) <-> Prisma OrganizationRole
const ROLE_TO_DB: Record<string, OrganizationRole> = {
  owner: OrganizationRole.OWNER,
  admin: OrganizationRole.ADMIN,
  quality: OrganizationRole.MANAGER,
  approver: OrganizationRole.MODELER,
  iso: OrganizationRole.AUDITOR
};

const ROLE_FROM_DB: Record<OrganizationRole, string> = {
  [OrganizationRole.OWNER]: 'owner',
  [OrganizationRole.ADMIN]: 'admin',
  [OrganizationRole.MANAGER]: 'quality',
  [OrganizationRole.MODELER]: 'approver',
  [OrganizationRole.AUDITOR]: 'iso',
  [OrganizationRole.VIEWER]: 'approver'
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organizacia';
}

function mapMember(membership: any) {
  return {
    id: membership.user.id,
    organizationId: membership.organizationId,
    name: membership.user.name,
    email: membership.user.email,
    roleId: ROLE_FROM_DB[membership.role as OrganizationRole] ?? 'approver',
    active: true,
    status: 'active'
  };
}

function mapOrganization(organization: any, ownerUserId: string) {
  return {
    id: organization.id,
    name: organization.name,
    ownerUserId,
    createdAt: organization.createdAt.toISOString().slice(0, 10)
  };
}

function mapInvitation(invitation: any) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    roleId: ROLE_FROM_DB[invitation.role as OrganizationRole] ?? 'approver',
    status: invitation.status.toLowerCase(),
    token: invitation.token,
    createdAt: invitation.createdAt.toISOString().slice(0, 10),
    expiresAt: invitation.expiresAt.toISOString().slice(0, 10)
  };
}

app.post('/api/register', async (request, response, next) => {
  try {
    const { organizationName, ownerName, email, password } = request.body ?? {};
    if (!organizationName || !ownerName || !email || !password) {
      throw new HttpError(400, 'organizationName, ownerName, email a password su povinne');
    }
    const normalizedEmail = String(email).toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new HttpError(409, 'Pouzivatel s tymto emailom uz existuje. Prihlas sa.');
    }

    const slugBase = slugify(organizationName);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: ownerName,
          passwordHash: hashPassword(password)
        }
      });
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug: `${slugBase}-${Date.now()}`
        }
      });
      await tx.organizationUser.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: OrganizationRole.OWNER,
          isOwner: true
        }
      });
      return { user, organization };
    });

    response.status(201).json({
      user: {
        id: result.user.id,
        organizationId: result.organization.id,
        name: result.user.name,
        email: result.user.email,
        roleId: 'owner',
        active: true,
        status: 'active'
      },
      organization: mapOrganization(result.organization, result.user.id)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', async (request, response, next) => {
  try {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      throw new HttpError(400, 'email a password su povinne');
    }
    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase() },
      include: {
        organizations: {
          orderBy: { createdAt: 'asc' },
          include: { organization: true }
        }
      }
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Nespravny email alebo heslo.');
    }
    const membership = user.organizations[0];
    if (!membership) {
      throw new HttpError(403, 'Pouzivatel nie je clenom ziadnej organizacie.');
    }
    const owner = await prisma.organizationUser.findFirst({
      where: { organizationId: membership.organizationId, isOwner: true }
    });
    response.json({
      user: {
        id: user.id,
        organizationId: membership.organizationId,
        name: user.name,
        email: user.email,
        roleId: ROLE_FROM_DB[membership.role] ?? 'approver',
        active: true,
        status: 'active'
      },
      organization: mapOrganization(membership.organization, owner?.userId ?? user.id)
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/organizations/:organizationId', async (request, response, next) => {
  try {
    const organization = await prisma.organization.update({
      where: { id: request.params.organizationId },
      data: { name: request.body.name ?? undefined }
    });
    const owner = await prisma.organizationUser.findFirst({
      where: { organizationId: organization.id, isOwner: true }
    });
    response.json(mapOrganization(organization, owner?.userId ?? ''));
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/users', async (request, response, next) => {
  try {
    const memberships = await prisma.organizationUser.findMany({
      where: { organizationId: request.params.organizationId },
      orderBy: { createdAt: 'asc' },
      include: { user: true }
    });
    response.json(memberships.map(mapMember));
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/invitations', async (request, response, next) => {
  try {
    const invitations = await prisma.invitation.findMany({
      where: { organizationId: request.params.organizationId },
      orderBy: { createdAt: 'desc' }
    });
    response.json(invitations.map(mapInvitation));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/invitations', async (request, response, next) => {
  try {
    const { email, roleId } = request.body ?? {};
    if (!email) {
      throw new HttpError(400, 'email je povinny');
    }
    const organization = await prisma.organization.findUnique({ where: { id: request.params.organizationId } });
    if (!organization) {
      throw new HttpError(404, 'Organizacia neexistuje');
    }
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        email: String(email).toLowerCase(),
        token: randomBytes(24).toString('hex'),
        role: ROLE_TO_DB[roleId] ?? OrganizationRole.VIEWER,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      }
    });
    response.status(201).json(mapInvitation(invitation));
  } catch (error) {
    next(error);
  }
});

app.get('/api/invitations/:token', async (request, response, next) => {
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { token: request.params.token },
      include: { organization: true }
    });
    if (!invitation) {
      throw new HttpError(404, 'Pozvanka neexistuje');
    }
    response.json({
      ...mapInvitation(invitation),
      organizationName: invitation.organization.name,
      expired: invitation.expiresAt.getTime() < Date.now()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/invitations/:token/accept', async (request, response, next) => {
  try {
    const { name, password } = request.body ?? {};
    if (!name || !password) {
      throw new HttpError(400, 'name a password su povinne');
    }
    const invitation = await prisma.invitation.findUnique({
      where: { token: request.params.token },
      include: { organization: true }
    });
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new HttpError(404, 'Pozvanka neexistuje alebo uz bola pouzita.');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.EXPIRED } });
      throw new HttpError(410, 'Pozvanka expirovala.');
    }

    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: invitation.email } });
      if (!user) {
        user = await tx.user.create({
          data: {
            email: invitation.email,
            name,
            passwordHash: hashPassword(password)
          }
        });
      }
      const membership = await tx.organizationUser.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
        update: { role: invitation.role },
        create: {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role
        }
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: InvitationStatus.ACCEPTED } });
      return { user, membership };
    });

    const owner = await prisma.organizationUser.findFirst({
      where: { organizationId: invitation.organizationId, isOwner: true }
    });
    response.json({
      user: {
        id: result.user.id,
        organizationId: invitation.organizationId,
        name: result.user.name,
        email: result.user.email,
        roleId: ROLE_FROM_DB[result.membership.role] ?? 'approver',
        active: true,
        status: 'active'
      },
      organization: mapOrganization(invitation.organization, owner?.userId ?? '')
    });
  } catch (error) {
    next(error);
  }
});

// Verejne preklady pre platformu — globalny slovnik { sk: {...}, en: {...} }
app.get('/api/translations', async (_request, response, next) => {
  try {
    const translations = await prisma.translation.findMany({ where: { organizationId: null } });
    const dictionary: Record<string, Record<string, string>> = {};
    for (const translation of translations) {
      dictionary[translation.locale] = dictionary[translation.locale] ?? {};
      dictionary[translation.locale][translation.key] = translation.value;
    }
    response.json(dictionary);
  } catch (error) {
    next(error);
  }
});

// --- Backoffice API (samostatna admin aplikacia process-platform-backoffice) ---

app.get('/api/backoffice/stats', async (_request, response, next) => {
  try {
    const [organizations, users, processes, translations] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.processNode.count({ where: { type: ProcessNodeType.PROCESS } }),
      prisma.translation.count({ where: { organizationId: null } })
    ]);
    response.json({ organizations, users, processes, translations });
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/organizations', async (_request, response, next) => {
  try {
    const organizations = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, processNodes: true } }
      }
    });
    response.json(organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      defaultLocale: organization.defaultLocale,
      camundaBaseUrl: organization.camundaBaseUrl,
      createdAt: organization.createdAt.toISOString().slice(0, 10),
      userCount: organization._count.users,
      processCount: organization._count.processNodes
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/translations', async (request, response, next) => {
  try {
    const locale = typeof request.query['locale'] === 'string' ? request.query['locale'] : undefined;
    const translations = await prisma.translation.findMany({
      where: { organizationId: null, ...(locale ? { locale } : {}) },
      orderBy: [{ locale: 'asc' }, { key: 'asc' }]
    });
    response.json(translations.map((translation) => ({
      id: translation.id,
      locale: translation.locale,
      key: translation.key,
      value: translation.value
    })));
  } catch (error) {
    next(error);
  }
});

// Postgres berie NULL != NULL, takze compound unique upsert s organizationId null
// nefunguje cez prisma.upsert — preto findFirst + update/create.
async function upsertGlobalTranslation(locale: string, key: string, value: string) {
  const existing = await prisma.translation.findFirst({
    where: { organizationId: null, locale, key }
  });
  if (existing) {
    return prisma.translation.update({ where: { id: existing.id }, data: { value } });
  }
  return prisma.translation.create({ data: { organizationId: null, locale, key, value } });
}

app.put('/api/backoffice/translations', async (request, response, next) => {
  try {
    const { locale, key, value } = request.body ?? {};
    if (!locale || !key || typeof value !== 'string') {
      throw new HttpError(400, 'locale, key a value su povinne');
    }
    const translation = await upsertGlobalTranslation(locale, key, value);
    response.json({
      id: translation.id,
      locale: translation.locale,
      key: translation.key,
      value: translation.value
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/backoffice/translations/import', async (request, response, next) => {
  try {
    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    let imported = 0;
    for (const item of items) {
      if (!item?.locale || !item?.key || typeof item?.value !== 'string') continue;
      await upsertGlobalTranslation(item.locale, item.key, item.value);
      imported += 1;
    }
    response.json({ imported });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/backoffice/translations/:translationId', async (request, response, next) => {
  try {
    await prisma.translation.delete({ where: { id: request.params.translationId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message });
    return;
  }
  response.status(500).json({
    message: error instanceof Error ? error.message : 'Unexpected server error'
  });
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
