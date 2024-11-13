import {IGitSourceSettings} from './git-source-settings'

export interface IPerforceSourceSettings extends IGitSourceSettings {
  /**
   * Name of the client workspace template to clone
   */
  clientTemplate: string
  /**
   * Use client template directly instead of creating a
   * runner-specific client
   */
  useClientTemplate: boolean
}
