# Contract change requests

Agents: don't edit `src/shared/types.ts` or `package.json`. Add a request here, commit it on your branch,
and tell the orchestrator. The orchestrator applies it on main and tells everyone to rebase.

Format:

```
## <date> — <agent letter> — <short title>
- File: src/shared/types.ts (or package.json)
- Change: <exact type/field/dependency>
- Why: <one line>
- Status: requested | applied in <commit>
```
