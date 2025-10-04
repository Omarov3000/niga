// import { execSync } from "child_process";
// import { writeFileSync, readFileSync, copyFileSync, unlinkSync } from "fs";

// const RUNS = 10;
// const TSCONFIG_PATH = "./tsconfig.json";
// const TSCONFIG_BACKUP = "./tsconfig.backup.json";

// function measureCompilationTime(testFile: string, runs: number): number[] {
//   const times: number[] = [];

//   // Backup original tsconfig
//   copyFileSync(TSCONFIG_PATH, TSCONFIG_BACKUP);

//   // Create a new simple tsconfig that includes only the test file
//   const newTsconfig = {
//     compilerOptions: {
//       target: "esnext",
//       lib: ["esnext"],
//       module: "esnext",
//       moduleResolution: "bundler",
//       resolveJsonModule: true,
//       allowJs: true,
//       checkJs: false,
//       noEmit: true,
//       jsx: "react-jsx",
//       isolatedModules: true,
//       allowSyntheticDefaultImports: true,
//       forceConsistentCasingInFileNames: true,
//       strict: true,
//       skipLibCheck: true,
//       noErrorTruncation: true,
//       noUnusedLocals: false,
//       noUnusedParameters: false
//     },
//     include: [testFile],
//     exclude: ["zod-classic", "zod-core"]
//   };

//   writeFileSync(TSCONFIG_PATH, JSON.stringify(newTsconfig, null, 2));

//   try {
//     for (let i = 0; i < runs; i++) {
//       const start = performance.now();
//       try {
//         execSync("pnpm tsc", { stdio: "ignore" });
//       } catch (error) {
//         // tsc might return non-zero exit code on type errors, but we still measure time
//       }
//       const end = performance.now();
//       times.push(end - start);
//       console.log(`  Run ${i + 1}/${runs}: ${(end - start).toFixed(2)}ms`);
//     }
//   } finally {
//     // Restore original tsconfig
//     copyFileSync(TSCONFIG_BACKUP, TSCONFIG_PATH);
//     unlinkSync(TSCONFIG_BACKUP);
//   }

//   return times;
// }

// function calculateStats(times: number[]) {
//   const avg = times.reduce((a, b) => a + b, 0) / times.length;
//   const sorted = [...times].sort((a, b) => a - b);
//   const median = sorted[Math.floor(sorted.length / 2)];
//   const min = Math.min(...times);
//   const max = Math.max(...times);
//   const stdDev = Math.sqrt(
//     times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / times.length
//   );

//   return { avg, median, min, max, stdDev };
// }

// console.log(`Running TypeScript compilation benchmark (${RUNS} runs each)\n`);

// console.log("Benchmarking Zod (types.zod.test.ts)...");
// const zodTimes = measureCompilationTime("src/types.zod.test.ts", RUNS);
// const zodStats = calculateStats(zodTimes);

// console.log("\nBenchmarking Custom Schema (types.test.ts)...");
// const customTimes = measureCompilationTime("src/types.test.ts", RUNS);
// const customStats = calculateStats(customTimes);

// console.log("\n" + "=".repeat(60));
// console.log("RESULTS");
// console.log("=".repeat(60));

// console.log("\nZod (types.zod.test.ts):");
// console.log(`  Average:   ${zodStats.avg.toFixed(2)}ms`);
// console.log(`  Median:    ${zodStats.median.toFixed(2)}ms`);
// console.log(`  Min:       ${zodStats.min.toFixed(2)}ms`);
// console.log(`  Max:       ${zodStats.max.toFixed(2)}ms`);
// console.log(`  Std Dev:   ${zodStats.stdDev.toFixed(2)}ms`);

// console.log("\nCustom Schema (types.test.ts):");
// console.log(`  Average:   ${customStats.avg.toFixed(2)}ms`);
// console.log(`  Median:    ${customStats.median.toFixed(2)}ms`);
// console.log(`  Min:       ${customStats.min.toFixed(2)}ms`);
// console.log(`  Max:       ${customStats.max.toFixed(2)}ms`);
// console.log(`  Std Dev:   ${customStats.stdDev.toFixed(2)}ms`);

// console.log("\n" + "=".repeat(60));
// console.log("COMPARISON");
// console.log("=".repeat(60));

// const speedup = zodStats.avg / customStats.avg;
// const percentFaster = ((zodStats.avg - customStats.avg) / zodStats.avg) * 100;

// if (speedup > 1) {
//   console.log(`\nCustom Schema is ${speedup.toFixed(2)}x FASTER than Zod`);
//   console.log(`(${percentFaster.toFixed(1)}% faster)`);
// } else {
//   console.log(`\nZod is ${(1 / speedup).toFixed(2)}x FASTER than Custom Schema`);
//   console.log(`(${(-percentFaster).toFixed(1)}% faster)`);
// }

// 13% slower than zod
