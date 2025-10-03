## What NOT to Do (Both Reports Agree)

- ❌ Don't add **NoNever** type utility
- ❌ Don't add **OmitIndexSignature** (not needed)
- ❌ Don't apply **Prettify** everywhere
- ❌ Don't inline schema definitions
- ❌ Don't add deep recursive type flattening

| Priority  | Change                        | File(s)          | Zod Evidence | Impact                           |
|-----------|-------------------------------|------------------|--------------|----------------------------------|
| 🔴 HIGH   | Index-signature short-circuit | object.ts        | ✅ Yes       | Large objects 30-50% faster      |
| 🔴 HIGH   | Shape any → unknown           | object.ts:7      | ✅ Yes       | Better type safety + perf        |
| 🔴 HIGH   | Record Extract vs &           | record.ts:13-17  | ✅ Best      | 10-20% faster                    |
| 🟡 MEDIUM | Schema generic covariance     | All schema files | ✅ Yes       | 15% faster checking              |
| 🟡 MEDIUM | Verify Identity/Flatten       | util.ts:18-20    | ✅ Yes       | 5-10% better caching             |
| 🟢 LOW    | Selective Prettify            | Various          | ✅ Yes       | Minor cleanup                    |
| 🟢 LOW    | Prettify comment hint         | util.ts:21-23    | ✅ Yes       | Marginal                         |
