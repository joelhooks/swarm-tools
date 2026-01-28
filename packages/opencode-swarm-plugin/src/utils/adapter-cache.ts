/**
 * Generic adapter cache for project-scoped singletons
 *
 * Caches expensive adapters (database connections, indexers, etc.)
 * keyed by project path. Ensures one instance per project.
 *
 * @example
 * ```ts
 * const memoryCache = new AdapterCache<MemoryAdapter>();
 * const adapter = await memoryCache.get(projectPath, async (path) => {
 *   const db = await getDatabase(path);
 *   return createMemoryAdapter(db);
 * });
 * ```
 */
export class AdapterCache<T> {
	private cached: T | null = null;
	private cachedPath: string | null = null;

	/**
	 * Get cached adapter or create new one
	 *
	 * @param projectPath - Project path to scope the adapter to
	 * @param factory - Async factory function to create the adapter
	 * @returns Cached or newly created adapter instance
	 */
	async get(
		projectPath: string,
		factory: (path: string) => Promise<T>,
	): Promise<T> {
		if (this.cached && this.cachedPath === projectPath) {
			return this.cached;
		}

		this.cached = await factory(projectPath);
		this.cachedPath = projectPath;
		return this.cached;
	}

	/**
	 * Clear the cache (useful for testing)
	 */
	clear(): void {
		this.cached = null;
		this.cachedPath = null;
	}

	/**
	 * Get the currently cached project path
	 */
	getCachedPath(): string | null {
		return this.cachedPath;
	}
}
