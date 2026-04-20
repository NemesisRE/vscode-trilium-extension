import * as vscode from 'vscode';

const SECRET_KEY = 'trilium.etapiToken';

export function getServerUrl(): string {
  return vscode.workspace
    .getConfiguration('trilium')
    .get<string>('serverUrl', 'http://localhost:8080')
    .replace(/\/$/, '');
}

export async function getToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_KEY);
}

export async function storeToken(secrets: vscode.SecretStorage, token: string): Promise<void> {
  await secrets.store(SECRET_KEY, token);
}

export async function deleteToken(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
}
