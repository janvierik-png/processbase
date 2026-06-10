import 'dotenv/config';
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, OrganizationRole, ProcessNodeType, ProcessStatus } from '../generated/prisma/client';

// Rovnaky format ako server/index.ts: scrypt$<salt>$<hash>
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not configured');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const emptyBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_Empty" targetNamespace="http://process-platform.local/bpmn">
  <bpmn:process id="Process_Empty" isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_Empty" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: 'demo-firma' },
    update: {},
    create: {
      name: 'Demo firma',
      slug: 'demo-firma',
      defaultLocale: 'sk',
      roles: {
        create: [
          {
            name: 'Manazer kvality',
            description: 'Sprava procesov, revizii a ISO dokumentacie.',
            permissions: ['process:write', 'revision:write', 'approval:request', 'iso:write']
          },
          {
            name: 'Auditor',
            description: 'Citanie procesov a auditnych podkladov.',
            permissions: ['process:read', 'revision:read', 'iso:read']
          }
        ]
      }
    }
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@example.com' },
    update: {},
    create: {
      email: 'owner@example.com',
      name: 'Owner Demo',
      passwordHash: 'dev-only-change-me'
    }
  });

  await prisma.organizationUser.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: owner.id
      }
    },
    update: { role: OrganizationRole.OWNER, isOwner: true },
    create: {
      organizationId: organization.id,
      userId: owner.id,
      role: OrganizationRole.OWNER,
      isOwner: true
    }
  });

  const group = await prisma.processNode.upsert({
    where: { id: 'demo-group-quality' },
    update: {},
    create: {
      id: 'demo-group-quality',
      organizationId: organization.id,
      type: ProcessNodeType.GROUP,
      name: 'Riadiace procesy / Kvalita',
      sortOrder: 10
    }
  });

  const process = await prisma.processNode.upsert({
    where: { id: 'demo-process-complaints' },
    update: {},
    create: {
      id: 'demo-process-complaints',
      organizationId: organization.id,
      parentId: group.id,
      ownerId: owner.id,
      type: ProcessNodeType.PROCESS,
      name: 'Riadenie reklamacie',
      description: 'Ukazkovy proces pre kvalitu a ISO 9001.',
      status: ProcessStatus.DRAFT,
      sortOrder: 10,
      bpmnXml: emptyBpmn,
      isoLinks: ['ISO 9001:8.7', 'ISO 9001:10.2']
    }
  });

  await prisma.processRevision.create({
    data: {
      processNodeId: process.id,
      authorId: owner.id,
      name: 'Vychozia verzia',
      note: 'Seed revizia pre ukazkovy proces.',
      bpmnXml: emptyBpmn
    }
  });

  await prisma.invitation.upsert({
    where: { token: 'demo-invite-token' },
    update: {},
    create: {
      organizationId: organization.id,
      email: 'auditor@example.com',
      token: 'demo-invite-token',
      role: OrganizationRole.AUDITOR,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
    }
  });

  const translations = [
    ['sk', 'app.title', 'Procesna kniznica'],
    ['sk', 'nav.processes', 'Procesy'],
    ['sk', 'nav.settings', 'Nastavenia firmy'],
    ['sk', 'nav.backoffice', 'Backoffice'],
    ['en', 'app.title', 'Process Library'],
    ['en', 'nav.processes', 'Processes'],
    ['en', 'nav.settings', 'Company settings'],
    ['en', 'nav.backoffice', 'Backoffice']
  ] as const;

  // R9: prvy backoffice admin (jano / Test123)
  await prisma.backofficeAdmin.upsert({
    where: { username: 'jano' },
    update: {},
    create: {
      username: 'jano',
      passwordHash: hashPassword('Test123')
    }
  });

  for (const [locale, key, value] of translations) {
    await prisma.translation.upsert({
      where: {
        organizationId_locale_key: {
          organizationId: organization.id,
          locale,
          key
        }
      },
      update: { value },
      create: {
        organizationId: organization.id,
        locale,
        key,
        value
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
