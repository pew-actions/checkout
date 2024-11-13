export class PerforceVersion {
  private readonly major: number = NaN
  private readonly minor: number = NaN

  /**
   * Used for comparing the version of p4 against the minimum required version
   * @param version the version string, e.g. 2023.3
   */
  constructor(version?: string) {
    if (version) {
      const match = version.match(/^(\d+)\.(\d+)?$/)
      if (match) {
        this.major = Number(match[1])
        this.minor = Number(match[2])
      }
    }
  }

  /**
   * Compares the instance against a minimum required version
   * @param minimum Minimum version
   */
  checkMinimum(minimum: PerforceVersion): boolean {
    if (!minimum.isValid()) {
      throw new Error('Arg minimum is not a valid version')
    }

    // Major is insufficient
    if (this.major < minimum.major) {
      return false
    }

    // Major is equal
    if (this.major === minimum.major) {
      // Minor is insufficient
      if (this.minor < minimum.minor) {
        return false
      }
    }

    return true
  }

  /**
   * Indicates whether the instance was constructed from a valid version string
   */
  isValid(): boolean {
    return !isNaN(this.major)
  }

  /**
   * Returns the version as a string, e.g. 2023.2
   */
  toString(): string {
    let result = ''
    if (this.isValid()) {
      result = `${this.major}.${this.minor}`
    }

    return result
  }
}

