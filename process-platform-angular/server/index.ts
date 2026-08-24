import 'dotenv/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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
  parentId?: string | null;
  children?: ProcessTreeNode[];
  owner?: string;
  status?: string;
  revision?: string;
  purpose?: string;
  risks?: string;
  descriptionText?: string;
  relatedProcessIds?: string[];
  positionIds?: string[];
  positions?: Array<{ id: string; name: string }>;
  isoSuggestions?: unknown;
  translations?: unknown;
  bpmnXml?: string;
  diagramType?: string;
  flowchartXml?: string;
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
    // obsah suboru sa vo vypisoch neposiela — na stiahnutie sluzi /api/documents/:id/download
    processId: attachment.processNodeId ?? undefined,
    processName: attachment.processNode?.name ?? undefined,
    positionIds: (attachment.positions ?? []).map((item: any) => item.positionId),
    positions: (attachment.positions ?? []).map((item: any) => ({
      id: item.position?.id ?? item.positionId,
      name: item.position?.name ?? ''
    }))
  };
}

const ATTACHMENT_INCLUDE = {
  processNode: true,
  uploadedBy: true,
  positions: { include: { position: true } }
};

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
    parentId: node.parentId ?? null,
    owner: node.owner?.name ?? '',
    status: mapStatusFromDb(node.status),
    revision: node.revisions?.[0]?.createdAt?.toISOString().slice(0, 10) ?? node.updatedAt?.toISOString().slice(0, 10),
    purpose: node.description ?? '',
    risks: '',
    descriptionText: node.descriptionText ?? '',
    relatedProcessIds: node.relatedProcessIds ?? [],
    positionIds: (node.positions ?? []).map((item: any) => item.positionId),
    positions: (node.positions ?? []).map((item: any) => ({ id: item.position?.id ?? item.positionId, name: item.position?.name ?? '' })),
    isoSuggestions: node.isoSuggestions ?? [],
    translations: node.translations ?? null,
    bpmnXml: node.bpmnXml ?? undefined,
    diagramType: node.diagramType ?? 'NONE',
    flowchartXml: node.flowchartXml ?? undefined,
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
        revisions: { orderBy: { createdAt: 'desc' } },
        positions: { include: { position: true } }
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

async function resolveUserId(headerValue: unknown): Promise<string | null> {
  if (typeof headerValue !== 'string' || !headerValue) return null;
  const user = await prisma.user.findUnique({ where: { id: headerValue } });
  return user?.id ?? null;
}

const PROCESS_INCLUDE = {
  owner: true,
  revisions: { orderBy: { createdAt: 'desc' as const } },
  children: true,
  positions: { include: { position: true } }
};

app.patch('/api/processes/:processId', async (request, response, next) => {
  try {
    const { processId } = request.params;
    const current = await prisma.processNode.findUnique({
      where: { id: processId },
      include: { positions: true }
    });
    if (!current) {
      response.status(404).json({ message: 'Process not found' });
      return;
    }

    const body = request.body ?? {};
    const data = {
      name: body.name ?? undefined,
      description: body.purpose ?? undefined,
      descriptionText: body.descriptionText ?? undefined,
      status: body.status ? mapStatusToDb(body.status) : undefined,
      bpmnXml: body.bpmnXml ?? undefined,
      diagramType: body.diagramType ?? undefined,
      flowchartXml: body.flowchartXml !== undefined ? (body.flowchartXml ?? null) : undefined,
      isoLinks: body.iso ? isoLinksFromBody(body.iso) : undefined,
      parentId: body.parentId === undefined ? undefined : body.parentId,
      sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
      relatedProcessIds: Array.isArray(body.relatedProcessIds) ? (body.relatedProcessIds as string[]) : undefined
    };

    // R7: diff zmenenych poli pre audit log
    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    const track = (field: string, from: unknown, to: unknown) => {
      if (to === undefined) return;
      // null a prazdny retazec povazuj za rovnake (ziadna realna zmena)
      if (JSON.stringify(from ?? '') === JSON.stringify(to ?? '')) return;
      changedFields[field] = { from, to };
    };
    track('name', current.name, data.name);
    track('purpose', current.description, data.description);
    track('descriptionText', current.descriptionText, data.descriptionText);
    track('status', current.status, data.status);
    track('parentId', current.parentId, data.parentId);
    track('relatedProcessIds', current.relatedProcessIds, data.relatedProcessIds);
    track('isoLinks', current.isoLinks, data.isoLinks);
    if (data.bpmnXml !== undefined && data.bpmnXml !== current.bpmnXml) {
      changedFields['bpmnXml'] = { from: '(diagram)', to: '(diagram zmeneny)' };
    }
    if ((data as any).diagramType !== undefined && (data as any).diagramType !== (current as any).diagramType) {
      changedFields['diagramType'] = { from: (current as any).diagramType, to: (data as any).diagramType };
    }
    if ((data as any).flowchartXml !== undefined && (data as any).flowchartXml !== (current as any).flowchartXml) {
      changedFields['flowchartXml'] = { from: '(flowchart)', to: '(flowchart zmeneny)' };
    }

    await prisma.processNode.update({ where: { id: processId }, data });

    // R1/R3: nastavenie priradenych pozicii
    if (Array.isArray(body.positionIds)) {
      const currentIds = current.positions.map((item) => item.positionId).sort();
      const nextIds = [...new Set(body.positionIds as string[])].sort();
      if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
        changedFields['positions'] = { from: currentIds, to: nextIds };
        await prisma.processPosition.deleteMany({ where: { processNodeId: processId } });
        if (nextIds.length > 0) {
          await prisma.processPosition.createMany({
            data: nextIds.map((positionId) => ({ processNodeId: processId, positionId }))
          });
        }
      }
    }

    if (Object.keys(changedFields).length > 0 || body.changeDescription) {
      await prisma.processChangeLog.create({
        data: {
          processNodeId: processId,
          userId: await resolveUserId(request.headers['x-user-id']),
          changedFields,
          description: body.changeDescription || null
        }
      });
    }

    // R5: prepocitaj ISO sugescie pri zmene textov
    if (changedFields['name'] || changedFields['purpose'] || changedFields['descriptionText']) {
      await computeIsoSuggestions(processId).catch(() => undefined);
      // R8: automaticky preklad (fire-and-forget)
      void autoTranslateProcess(current.organizationId, processId);
    }

    const fresh = await prisma.processNode.findUnique({ where: { id: processId }, include: PROCESS_INCLUDE });
    response.json(mapNode(fresh));
  } catch (error) {
    next(error);
  }
});

// R3: detail procesu s rozsirenymi vazbami
app.get('/api/processes/:processId', async (request, response, next) => {
  try {
    const node = await prisma.processNode.findUnique({
      where: { id: request.params.processId },
      include: { ...PROCESS_INCLUDE, parent: true }
    });
    if (!node) {
      response.status(404).json({ message: 'Process not found' });
      return;
    }
    const related = node.relatedProcessIds.length
      ? await prisma.processNode.findMany({
          where: { id: { in: node.relatedProcessIds } },
          select: { id: true, name: true }
        })
      : [];
    response.json({
      ...mapNode(node),
      parentName: (node as any).parent?.name ?? null,
      childProcesses: (node.children ?? []).map((child: any) => ({ id: child.id, name: child.name })),
      relatedProcesses: related
    });
  } catch (error) {
    next(error);
  }
});

// R7: historia zmien procesu
app.get('/api/processes/:processId/history', async (request, response, next) => {
  try {
    const logs = await prisma.processChangeLog.findMany({
      where: { processNodeId: request.params.processId },
      orderBy: { createdAt: 'desc' },
      include: { user: true }
    });
    response.json(logs.map((log) => ({
      id: log.id,
      date: log.createdAt.toISOString(),
      userName: log.user?.name ?? 'Neznamy',
      changedFields: log.changedFields,
      description: log.description
    })));
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
      include: ATTACHMENT_INCLUDE
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
      include: ATTACHMENT_INCLUDE
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
      include: ATTACHMENT_INCLUDE
    });
    response.status(201).json(mapAttachment(attachment));
  } catch (error) {
    next(error);
  }
});

// premenovanie dokumentu + priradenie pracovnym poziciam
app.patch('/api/documents/:documentId', async (request, response, next) => {
  try {
    const { documentId } = request.params;
    const existing = await prisma.attachment.findUnique({ where: { id: documentId } });
    if (!existing) {
      response.status(404).json({ message: 'Dokument sa nenasiel.' });
      return;
    }

    const fileName = typeof request.body?.name === 'string' ? request.body.name.trim() : undefined;
    if (fileName !== undefined && !fileName) throw new HttpError(400, 'Nazov dokumentu nesmie byt prazdny.');

    if (fileName !== undefined) {
      await prisma.attachment.update({ where: { id: documentId }, data: { fileName } });
    }

    if (Array.isArray(request.body?.positionIds)) {
      const nextIds = [...new Set(request.body.positionIds as string[])];
      await prisma.attachmentPosition.deleteMany({ where: { attachmentId: documentId } });
      if (nextIds.length > 0) {
        await prisma.attachmentPosition.createMany({
          data: nextIds.map((positionId) => ({ attachmentId: documentId, positionId })),
          skipDuplicates: true
        });
      }
    }

    const fresh = await prisma.attachment.findUnique({
      where: { id: documentId },
      include: ATTACHMENT_INCLUDE
    });
    response.json(mapAttachment(fresh));
  } catch (error) {
    next(error);
  }
});

// stiahnutie dokumentu — obsah je ulozeny ako data URL v storagePath
app.get('/api/documents/:documentId/download', async (request, response, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: request.params.documentId } });
    if (!attachment) {
      response.status(404).json({ message: 'Dokument sa nenasiel.' });
      return;
    }

    const stored = attachment.storagePath ?? '';
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(stored);
    if (!match) {
      response.status(409).json({ message: 'Dokument nema ulozeny obsah.' });
      return;
    }

    const [, storedMime, base64Flag, payload] = match;
    const body = base64Flag
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');

    // RFC 5987 — aby fungovala aj diakritika v nazve suboru
    const fileName = attachment.fileName || 'dokument';
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

    response.setHeader('Content-Type', attachment.mimeType || storedMime || 'application/octet-stream');
    response.setHeader('Content-Length', String(body.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    response.send(body);
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
    status: 'active',
    positions: (membership.user.positions ?? []).map((item: any) => ({
      id: item.position.id,
      name: item.position.name
    }))
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
      include: { user: { include: { positions: { include: { position: true } } } } }
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
    // R11: email uz je clenom organizacie
    const existingMember = await prisma.organizationUser.findFirst({
      where: {
        organizationId: organization.id,
        user: { email: String(email).toLowerCase() }
      }
    });
    if (existingMember) {
      throw new HttpError(409, 'Pouzivatel s tymto emailom uz je clenom organizacie.');
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

// --- R11: realtime validacia registracie ---

app.get('/api/check/email', async (request, response, next) => {
  try {
    const value = String(request.query['value'] ?? '').toLowerCase().trim();
    if (!value) {
      response.json({ available: false });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: value } });
    response.json({ available: !user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/check/org-name', async (request, response, next) => {
  try {
    const value = String(request.query['value'] ?? '').trim();
    if (!value) {
      response.json({ available: false });
      return;
    }
    const organization = await prisma.organization.findFirst({
      where: { name: { equals: value, mode: 'insensitive' } }
    });
    response.json({ available: !organization });
  } catch (error) {
    next(error);
  }
});

// --- R1: pracovne pozicie ---

function mapOrgPosition(position: any) {
  return {
    id: position.id,
    organizationId: position.organizationId,
    unitId: position.unitId ?? null,
    unitName: position.unit?.name ?? null,
    name: position.name,
    description: position.description ?? '',
    createdAt: position.createdAt.toISOString().slice(0, 10),
    assignedUsers: (position.users ?? []).map((item: any) => ({ id: item.user.id, name: item.user.name }))
  };
}

function mapOrgUnit(unit: any) {
  return {
    id: unit.id,
    organizationId: unit.organizationId,
    name: unit.name,
    description: unit.description ?? '',
    sortOrder: unit.sortOrder ?? 0,
    positionCount: unit._count?.positions ?? (unit.positions?.length ?? 0)
  };
}

const POSITION_INCLUDE = { users: { include: { user: true } }, unit: true };

// --- organizacne zlozky (utvary) ---

app.get('/api/organizations/:organizationId/units', async (request, response, next) => {
  try {
    const units = await prisma.orgUnit.findMany({
      where: { organizationId: request.params.organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { positions: true } } }
    });
    response.json(units.map(mapOrgUnit));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/units', async (request, response, next) => {
  try {
    const { name, description } = request.body ?? {};
    if (!name?.trim()) throw new HttpError(400, 'name je povinny');
    const existing = await prisma.orgUnit.findFirst({
      where: { organizationId: request.params.organizationId, name: { equals: name.trim(), mode: 'insensitive' } }
    });
    if (existing) throw new HttpError(409, 'Zlozka s tymto nazvom uz existuje.');
    const unit = await prisma.orgUnit.create({
      data: {
        organizationId: request.params.organizationId,
        name: name.trim(),
        description: description?.trim() || null
      },
      include: { _count: { select: { positions: true } } }
    });
    response.status(201).json(mapOrgUnit(unit));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/units/:unitId', async (request, response, next) => {
  try {
    const unit = await prisma.orgUnit.update({
      where: { id: request.params.unitId },
      data: {
        name: request.body.name?.trim() || undefined,
        description: request.body.description === undefined ? undefined : (request.body.description?.trim() || null),
        sortOrder: request.body.sortOrder === undefined ? undefined : Number(request.body.sortOrder)
      },
      include: { _count: { select: { positions: true } } }
    });
    response.json(mapOrgUnit(unit));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/units/:unitId', async (request, response, next) => {
  try {
    // pozicie ostavaju, len stratia zaradenie (onDelete: SetNull)
    await prisma.orgUnit.delete({ where: { id: request.params.unitId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/positions', async (request, response, next) => {
  try {
    const positions = await prisma.orgPosition.findMany({
      where: { organizationId: request.params.organizationId },
      orderBy: { name: 'asc' },
      include: POSITION_INCLUDE
    });
    response.json(positions.map(mapOrgPosition));
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/positions', async (request, response, next) => {
  try {
    const { name, description, unitId } = request.body ?? {};
    if (!name) throw new HttpError(400, 'name je povinny');
    const existing = await prisma.orgPosition.findFirst({
      where: { organizationId: request.params.organizationId, name: { equals: name, mode: 'insensitive' } }
    });
    if (existing) throw new HttpError(409, 'Pozicia s tymto nazvom uz existuje.');
    const position = await prisma.orgPosition.create({
      data: {
        organizationId: request.params.organizationId,
        name,
        description: description || null,
        unitId: unitId || null
      },
      include: POSITION_INCLUDE
    });
    response.status(201).json(mapOrgPosition(position));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/positions/:positionId', async (request, response, next) => {
  try {
    const position = await prisma.orgPosition.update({
      where: { id: request.params.positionId },
      data: {
        name: request.body.name ?? undefined,
        description: request.body.description === undefined ? undefined : (request.body.description || null),
        unitId: request.body.unitId === undefined ? undefined : (request.body.unitId || null)
      },
      include: POSITION_INCLUDE
    });
    response.json(mapOrgPosition(position));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/positions/:positionId', async (request, response, next) => {
  try {
    await prisma.orgPosition.delete({ where: { id: request.params.positionId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/users/:userId/positions', async (request, response, next) => {
  try {
    const { positionId } = request.body ?? {};
    if (!positionId) throw new HttpError(400, 'positionId je povinny');
    await prisma.userPosition.upsert({
      where: { userId_positionId: { userId: request.params.userId, positionId } },
      update: {},
      create: { userId: request.params.userId, positionId }
    });
    response.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/users/:userId/positions/:positionId', async (request, response, next) => {
  try {
    await prisma.userPosition.deleteMany({
      where: { userId: request.params.userId, positionId: request.params.positionId }
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- R8: nastavenia automatickeho prekladu (sifrovany API kluc) ---

const ENCRYPTION_SECRET = process.env['SETTINGS_ENCRYPTION_KEY'] ?? 'dev-settings-encryption-key';
const encryptionKey = scryptSync(ENCRYPTION_SECRET, 'processbase-settings', 32);

function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}

function decryptSecret(stored: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = stored.split('.');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

app.get('/api/organizations/:organizationId/settings/translation', async (request, response, next) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: request.params.organizationId } });
    if (!organization) throw new HttpError(404, 'Organizacia neexistuje');
    response.json({
      autoTranslate: organization.autoTranslate,
      provider: organization.translationProvider ?? 'deepl',
      targetLocale: organization.translationTargetLocale ?? 'en',
      hasApiKey: Boolean(organization.translationApiKeyEnc)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/settings/translation', async (request, response, next) => {
  try {
    const { autoTranslate, provider, targetLocale, apiKey } = request.body ?? {};
    const organization = await prisma.organization.update({
      where: { id: request.params.organizationId },
      data: {
        autoTranslate: Boolean(autoTranslate),
        translationProvider: provider || null,
        translationTargetLocale: targetLocale || null,
        translationApiKeyEnc: apiKey ? encryptSecret(String(apiKey)) : undefined
      }
    });
    response.json({
      autoTranslate: organization.autoTranslate,
      provider: organization.translationProvider ?? 'deepl',
      targetLocale: organization.translationTargetLocale ?? 'en',
      hasApiKey: Boolean(organization.translationApiKeyEnc)
    });
  } catch (error) {
    next(error);
  }
});

async function translateTexts(
  provider: string,
  apiKey: string,
  targetLocale: string,
  texts: string[]
): Promise<string[] | null> {
  try {
    if (provider === 'google') {
      const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, target: targetLocale, format: 'text' })
      });
      if (!response.ok) return null;
      const body: any = await response.json();
      return (body?.data?.translations ?? []).map((item: any) => item.translatedText ?? '');
    }
    // DeepL (default) — free kluce konca na :fx a pouzivaju api-free subdomain
    const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const response = await fetch(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `DeepL-Auth-Key ${apiKey}`
      },
      body: JSON.stringify({ text: texts, target_lang: targetLocale.toUpperCase() })
    });
    if (!response.ok) return null;
    const body: any = await response.json();
    return (body?.translations ?? []).map((item: any) => item.text ?? '');
  } catch {
    return null;
  }
}

async function autoTranslateProcess(organizationId: string, processId: string): Promise<void> {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization?.autoTranslate || !organization.translationApiKeyEnc || !organization.translationTargetLocale) return;
    const apiKey = decryptSecret(organization.translationApiKeyEnc);
    if (!apiKey) return;
    const node = await prisma.processNode.findUnique({ where: { id: processId } });
    if (!node) return;
    const texts = [node.name, node.descriptionText ?? ''];
    const translated = await translateTexts(organization.translationProvider ?? 'deepl', apiKey, organization.translationTargetLocale, texts);
    if (!translated) return;
    const existing = (node.translations as Record<string, unknown> | null) ?? {};
    await prisma.processNode.update({
      where: { id: processId },
      data: {
        translations: {
          ...existing,
          [organization.translationTargetLocale]: {
            name: translated[0] ?? node.name,
            descriptionText: translated[1] ?? ''
          }
        }
      }
    });
  } catch (error) {
    console.error('Auto-translate zlyhal:', error);
  }
}

// --- R4/R5/R6: ISO normy a detekcia ---

type IsoClause = { clause: string; title: string; children?: IsoClause[] };

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter((token) => token.length > 2);
}

function flattenClauses(structure: unknown, normId: string, normName: string): Array<{ isoTemplateId: string; normName: string; clause: string; title: string }> {
  const result: Array<{ isoTemplateId: string; normName: string; clause: string; title: string }> = [];
  const walk = (items: IsoClause[] | undefined) => {
    for (const item of items ?? []) {
      result.push({ isoTemplateId: normId, normName, clause: item.clause, title: item.title });
      walk(item.children);
    }
  };
  walk(structure as IsoClause[] | undefined);
  return result;
}

async function computeIsoSuggestions(processId: string) {
  const node = await prisma.processNode.findUnique({ where: { id: processId } });
  if (!node) return [];
  const norms = await prisma.isoTemplate.findMany({ where: { structure: { not: undefined } } });
  const processTokens = new Set(tokenize(`${node.name} ${node.description ?? ''} ${node.descriptionText ?? ''}`));
  if (processTokens.size === 0) return [];

  const suggestions: Array<{ isoTemplateId: string; normName: string; clause: string; title: string; confidence: number }> = [];
  for (const norm of norms) {
    if (!norm.structure) continue;
    for (const clause of flattenClauses(norm.structure, norm.id, norm.name ?? norm.standard)) {
      const clauseTokens = tokenize(clause.title);
      if (clauseTokens.length === 0) continue;
      const matched = clauseTokens.filter((token) => processTokens.has(token)).length;
      if (matched === 0) continue;
      suggestions.push({ ...clause, confidence: Math.round((matched / clauseTokens.length) * 100) / 100 });
    }
  }
  suggestions.sort((a, b) => b.confidence - a.confidence);
  const top = suggestions.slice(0, 5);
  await prisma.processNode.update({ where: { id: processId }, data: { isoSuggestions: top } });
  return top;
}

app.post('/api/processes/:processId/iso-detect', async (request, response, next) => {
  try {
    response.json(await computeIsoSuggestions(request.params.processId));
  } catch (error) {
    next(error);
  }
});

// R6: verejny zoznam ISO noriem pre platformu
app.get('/api/iso-norms', async (_request, response, next) => {
  try {
    const norms = await prisma.isoTemplate.findMany({
      where: { name: { not: null } },
      orderBy: { createdAt: 'desc' }
    });
    response.json(norms.map((norm) => ({
      id: norm.id,
      name: norm.name ?? norm.standard,
      version: norm.version ?? '',
      language: norm.language ?? 'sk',
      structure: norm.structure ?? []
    })));
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

// --- R9: Backoffice autentifikacia (HMAC token) ---

const BACKOFFICE_SECRET = process.env['BACKOFFICE_JWT_SECRET'] ?? 'dev-backoffice-secret-change-me';
const BACKOFFICE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function signBackofficeToken(adminId: string, username: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: adminId,
    username,
    exp: Date.now() + BACKOFFICE_TOKEN_TTL_MS
  })).toString('base64url');
  const signature = createHmac('sha256', BACKOFFICE_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyBackofficeToken(token: string): { sub: string; username: string } | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', BACKOFFICE_SECRET).update(payload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { sub: data.sub, username: data.username };
  } catch {
    return null;
  }
}

app.post('/api/backoffice/auth/login', async (request, response, next) => {
  try {
    const { username, password } = request.body ?? {};
    if (!username || !password) throw new HttpError(400, 'username a password su povinne');
    const admin = await prisma.backofficeAdmin.findUnique({ where: { username: String(username) } });
    if (!admin || !verifyPassword(String(password), admin.passwordHash)) {
      throw new HttpError(401, 'Nespravne prihlasovacie udaje.');
    }
    response.json({ token: signBackofficeToken(admin.id, admin.username), username: admin.username });
  } catch (error) {
    next(error);
  }
});

app.post('/api/backoffice/auth/logout', (_request, response) => {
  // Token je stateless — logout je zahodenie tokenu na klientovi.
  response.json({ ok: true });
});

// Guard pre vsetky dalsie /api/backoffice/* routy (login/logout su registrovane vyssie)
app.use('/api/backoffice', (request, response, next) => {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = verifyBackofficeToken(token);
  if (!session) {
    response.status(401).json({ message: 'Neautorizovany pristup do backoffice.' });
    return;
  }
  (request as any).backofficeAdmin = session;
  next();
});

// Sprava backoffice adminov
app.get('/api/backoffice/admins', async (_request, response, next) => {
  try {
    const admins = await prisma.backofficeAdmin.findMany({ orderBy: { createdAt: 'asc' } });
    response.json(admins.map((admin) => ({
      id: admin.id,
      username: admin.username,
      createdAt: admin.createdAt.toISOString().slice(0, 10)
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/backoffice/admins', async (request, response, next) => {
  try {
    const { username, password } = request.body ?? {};
    if (!username || !password) throw new HttpError(400, 'username a password su povinne');
    const existing = await prisma.backofficeAdmin.findUnique({ where: { username: String(username) } });
    if (existing) throw new HttpError(409, 'Admin s tymto menom uz existuje.');
    const admin = await prisma.backofficeAdmin.create({
      data: { username: String(username), passwordHash: hashPassword(String(password)) }
    });
    response.status(201).json({ id: admin.id, username: admin.username, createdAt: admin.createdAt.toISOString().slice(0, 10) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/backoffice/admins/:adminId', async (request, response, next) => {
  try {
    const count = await prisma.backofficeAdmin.count();
    if (count <= 1) throw new HttpError(400, 'Nemozno vymazat posledneho admina.');
    await prisma.backofficeAdmin.delete({ where: { id: request.params.adminId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

// --- R4: ISO normy — upload PDF a generovanie struktury ---

async function extractIsoStructureFromPdf(pdfBase64: string): Promise<IsoClause[]> {
  const { PDFParse } = await import('pdf-parse');
  const buffer = Buffer.from(pdfBase64, 'base64');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
  await parser.destroy();
  const lines: string[] = String(parsed.text ?? '').split(/\r?\n/);

  const clausePattern = /^(\d{1,2}(?:\.\d{1,2}){0,2})[\s.):–—-]+(\S.{2,90})$/;
  const seen = new Set<string>();
  const flat: Array<{ clause: string; title: string; level: number }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(clausePattern);
    if (!match) continue;
    const clause = match[1];
    const title = match[2].replace(/[.…]{2,}\s*\d*$/, '').trim(); // odstran bodkovane vyplne z obsahu
    const level = clause.split('.').length;
    if (level > 3) continue;
    const top = Number(clause.split('.')[0]);
    if (!Number.isFinite(top) || top < 1 || top > 30) continue;
    if (title.length < 3 || /^\d+$/.test(title)) continue;
    if (seen.has(clause)) continue;
    seen.add(clause);
    flat.push({ clause, title, level });
  }

  // zostav hierarchiu z plocheho zoznamu
  const roots: IsoClause[] = [];
  const byClause = new Map<string, IsoClause>();
  for (const item of flat.sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }))) {
    const node: IsoClause = { clause: item.clause, title: item.title, children: [] };
    byClause.set(item.clause, node);
    const parentClause = item.clause.split('.').slice(0, -1).join('.');
    const parent = byClause.get(parentClause);
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function mapIsoNorm(norm: any) {
  return {
    id: norm.id,
    name: norm.name ?? norm.standard,
    version: norm.version ?? '',
    language: norm.language ?? 'sk',
    structure: norm.structure ?? [],
    createdAt: norm.createdAt?.toISOString().slice(0, 10) ?? ''
  };
}

app.post('/api/backoffice/iso', async (request, response, next) => {
  try {
    const { name, version, language, pdfBase64, structure } = request.body ?? {};
    if (!name) throw new HttpError(400, 'name je povinny');
    let resolvedStructure: IsoClause[] = Array.isArray(structure) ? structure : [];
    if (pdfBase64) {
      resolvedStructure = await extractIsoStructureFromPdf(String(pdfBase64));
      if (resolvedStructure.length === 0) {
        throw new HttpError(422, 'Z PDF sa nepodarilo extrahovat strukturu kapitol. Skus manualny vstup.');
      }
    }
    const norm = await prisma.isoTemplate.create({
      data: {
        standard: String(name),
        name: String(name),
        version: version ? String(version) : null,
        language: language ? String(language) : 'sk',
        structure: resolvedStructure as any
      }
    });
    response.status(201).json(mapIsoNorm(norm));
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/iso', async (_request, response, next) => {
  try {
    const norms = await prisma.isoTemplate.findMany({
      where: { name: { not: null } },
      orderBy: { createdAt: 'desc' }
    });
    response.json(norms.map(mapIsoNorm));
  } catch (error) {
    next(error);
  }
});

app.get('/api/backoffice/iso/:normId', async (request, response, next) => {
  try {
    const norm = await prisma.isoTemplate.findUnique({ where: { id: request.params.normId } });
    if (!norm) throw new HttpError(404, 'Norma neexistuje');
    response.json(mapIsoNorm(norm));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/backoffice/iso/:normId', async (request, response, next) => {
  try {
    const norm = await prisma.isoTemplate.update({
      where: { id: request.params.normId },
      data: {
        name: request.body.name ?? undefined,
        standard: request.body.name ?? undefined,
        version: request.body.version === undefined ? undefined : (request.body.version || null),
        language: request.body.language ?? undefined,
        structure: request.body.structure === undefined ? undefined : request.body.structure
      }
    });
    response.json(mapIsoNorm(norm));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/backoffice/iso/:normId', async (request, response, next) => {
  try {
    await prisma.isoTemplate.delete({ where: { id: request.params.normId } });
    response.status(204).end();
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
