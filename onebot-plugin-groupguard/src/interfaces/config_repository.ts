export interface IConfigRepository {
  save(): void | Promise<void>;
}
