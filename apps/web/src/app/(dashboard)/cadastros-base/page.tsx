'use client';

import { Building2, Layers, Briefcase } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MiniCrud } from '@/components/cadastros/mini-crud';
import {
  listarDepartamentos, criarDepartamento, atualizarDepartamento, removerDepartamento,
  listarCargos, criarCargo, atualizarCargo, removerCargo,
  listarEmpresas, criarEmpresa, atualizarEmpresa, removerEmpresa,
  mascararCnpj,
} from '@/lib/colaboradores';

export default function CadastrosBasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Cadastros Base</h2>
        <p className="text-sm text-muted-foreground">
          Parâmetros do sistema — listas que alimentam os cadastros de colaboradores.
        </p>
      </div>

      <Tabs defaultValue="departamentos" className="space-y-6">
        <TabsList>
          <TabsTrigger value="departamentos"><Layers className="h-4 w-4" /> Departamentos</TabsTrigger>
          <TabsTrigger value="cargos"><Briefcase className="h-4 w-4" /> Cargos</TabsTrigger>
          <TabsTrigger value="empresas"><Building2 className="h-4 w-4" /> Empresas</TabsTrigger>
        </TabsList>

        <TabsContent value="departamentos">
          <MiniCrud
            singular="Departamento"
            queryKey="cadastros-departamentos"
            campos={[{ name: 'nome', label: 'Nome do departamento', placeholder: 'Ex.: Jurídico' }]}
            colunas={[{ key: 'nome', label: 'Nome' }]}
            api={{
              listar: listarDepartamentos,
              criar: (v) => criarDepartamento(v.nome),
              atualizar: (id, v) => atualizarDepartamento(id, v.nome),
              remover: removerDepartamento,
            }}
          />
        </TabsContent>

        <TabsContent value="cargos">
          <MiniCrud
            singular="Cargo"
            queryKey="cadastros-cargos"
            campos={[{ name: 'nome', label: 'Nome do cargo', placeholder: 'Ex.: Advogado(a)' }]}
            colunas={[{ key: 'nome', label: 'Nome' }]}
            api={{
              listar: listarCargos,
              criar: (v) => criarCargo(v.nome),
              atualizar: (id, v) => atualizarCargo(id, v.nome),
              remover: removerCargo,
            }}
          />
        </TabsContent>

        <TabsContent value="empresas">
          <MiniCrud
            singular="Empresa"
            queryKey="cadastros-empresas"
            campos={[
              { name: 'razaoSocial', label: 'Razão social', placeholder: 'Ex.: ACME Serviços LTDA' },
              { name: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00', mask: mascararCnpj },
            ]}
            colunas={[
              { key: 'razaoSocial', label: 'Razão social' },
              { key: 'cnpj', label: 'CNPJ', format: mascararCnpj, mono: true },
            ]}
            api={{
              listar: listarEmpresas,
              criar: (v) => criarEmpresa({ razaoSocial: v.razaoSocial, cnpj: v.cnpj }),
              atualizar: (id, v) => atualizarEmpresa(id, { razaoSocial: v.razaoSocial, cnpj: v.cnpj }),
              remover: removerEmpresa,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
