import { Injectable } from '@nestjs/common';
import { requirementEvidenceTokenSchema, type RequirementEvidenceToken } from '@myteam/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { ApiException } from './http.js';

// 下游用例、验收及发布模块在自身授权事务内调用；同一项目锁覆盖捕获/校验与后续写入。
@Injectable()
export class RequirementValidity {
  private async lock(tx: Prisma.TransactionClient, projectId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    if (!rows.length) throw new ApiException(404, 'NOT_FOUND', '项目不存在');
  }
  async capture(
    tx: Prisma.TransactionClient,
    projectId: string,
    ids: string[],
  ): Promise<RequirementEvidenceToken[]> {
    await this.lock(tx, projectId);
    const unique = [...new Set(ids)];
    if (!unique.length)
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '证据必须引用具体需求范围');
    const rows = await tx.requirement.findMany({
      where: { projectId, id: { in: unique } },
      orderBy: { id: 'asc' },
    });
    if (
      rows.length !== unique.length ||
      rows.some(
        (row) =>
          !['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
            row.status,
          ) || row.acceptedRevision !== row.revision,
      )
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '需求范围尚未重新确认，不能形成有效测试、验收或发布依据',
      );
    return rows.map((row) => ({
      requirementId: row.id,
      revision: row.revision,
      scopeVersion: row.scopeVersion,
    }));
  }
  async assertCurrent(
    tx: Prisma.TransactionClient,
    projectId: string,
    input: RequirementEvidenceToken[],
  ) {
    const tokens = input.map((value) => requirementEvidenceTokenSchema.parse(value));
    const current = await this.capture(
      tx,
      projectId,
      tokens.map((token) => token.requirementId),
    );
    if (
      tokens.length !== current.length ||
      tokens.some(
        (token) =>
          !current.some(
            (row) =>
              row.requirementId === token.requirementId &&
              row.revision === token.revision &&
              row.scopeVersion === token.scopeVersion,
          ),
      )
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '需求基线已变化，旧用例评审、验收或发布检查依据已失效，请重新处理',
      );
  }
}
