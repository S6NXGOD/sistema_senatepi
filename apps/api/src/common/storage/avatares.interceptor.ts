import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { AvataresService } from './avatares.service';

/**
 * Resolve as fotos de perfil na saída de QUALQUER rota.
 *
 * POR QUE GLOBAL
 * O erro que isto corrige estava espalhado por doze consultas de seis módulos
 * diferentes, todas cometendo o mesmo engano: ler `avatarUrl` do banco achando
 * que ali está a foto. Corrigir consulta por consulta deixaria a próxima
 * consulta livre para repetir o engano — e ninguém perceberia, porque a falha
 * não quebra nada: apenas mostra a inicial no lugar do rosto.
 *
 * A regra é estreita: só mexe em objeto que carrega `avatarKey`. Uma resposta
 * sem foto nenhuma atravessa o interceptor sem alteração alguma.
 *
 * O QUE ISSO EXIGE DE QUEM ESCREVE UMA CONSULTA NOVA: selecionar `avatarKey`
 * junto de `avatarUrl`. A partir daí a foto aparece sozinha — e a chave do
 * storage não vaza, porque o resolvedor a remove depois de usar.
 */
@Injectable()
export class AvataresInterceptor implements NestInterceptor {
  constructor(private readonly avatares: AvataresService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(switchMap((dados) => from(this.avatares.resolver(dados))));
  }
}
