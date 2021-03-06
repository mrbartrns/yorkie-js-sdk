/*
 * Copyright 2020 The Yorkie Authors. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { logger, LogLevel } from '../../util/logger';
import { TimeTicket } from '../time/ticket';
import { SetOperation } from '../operation/set_operation';
import { RemoveOperation } from '../operation/remove_operation';
import { ChangeContext } from '../change/context';
import { JSONObject } from '../json/object';
import { JSONArray } from '../json/array';
import { JSONPrimitive } from '../json/primitive';
import { RGATreeSplit } from '../json/rga_tree_split';
import { PlainText } from '../json/text';
import { RichText } from '../json/rich_text';
import { ArrayProxy } from './array_proxy';
import { TextProxy } from './text_proxy';
import { RichTextProxy } from './rich_text_proxy';
import { toProxy } from './proxy';

export class ObjectProxy {
  private context: ChangeContext;
  private handlers: any;

  constructor(context: ChangeContext) {
    this.context = context;
    this.handlers = {
      set: (target: JSONObject, key: string, value: any): boolean => {
        if (logger.isEnabled(LogLevel.Trivial)) {
          logger.trivial(`obj[${key}]=${JSON.stringify(value)}`);
        }

        ObjectProxy.setInternal(context, target, key, value);
        return true;
      },

      get: (target: JSONObject, keyOrMethod: string): any => {
        if (logger.isEnabled(LogLevel.Trivial)) {
          logger.trivial(`obj[${keyOrMethod}]`);
        }

        if (keyOrMethod === 'getID') {
          return (): TimeTicket => {
            return target.getCreatedAt();
          }; 
        } else if (keyOrMethod === 'toJSON') {
          return (): string => {
            return target.toJSON();
          };
        } else if (keyOrMethod === 'createText') {
          return (key: string): PlainText => {
            if (logger.isEnabled(LogLevel.Trivial)) {
              logger.trivial(`obj[${key}]=Text`);
            }
            return ObjectProxy.createText(context, target, key);
          };
        } else if (keyOrMethod === 'createRichText') {
          return (key: string): RichText => {
            if (logger.isEnabled(LogLevel.Trivial)) {
              logger.trivial(`obj[${key}]=Text`);
            }
            return ObjectProxy.createRichText(context, target, key);
          };
        }

        return toProxy(context, target.get(keyOrMethod));
      },

      deleteProperty: (target: JSONObject, key: string): boolean => {
        if (logger.isEnabled(LogLevel.Trivial)) {
          logger.trivial(`obj[${key}]`);
        }

        ObjectProxy.deleteInternal(context, target, key);
        return true;
      }
    }
  }

  public static create(context: ChangeContext, target: JSONObject): JSONObject {
    const objectProxy = new ObjectProxy(context);
    return new Proxy(target, objectProxy.getHandlers());
  }

  public static setInternal(context: ChangeContext, target: JSONObject, key: string, value: any): void {
    const ticket = context.issueTimeTicket();

    if (JSONPrimitive.isSupport(value)) {
      const primitive = JSONPrimitive.of(value, ticket);
      target.set(key, primitive);
      context.registerElement(primitive);
      context.push(SetOperation.create(key, primitive, target.getCreatedAt(), ticket));
    } else if (Array.isArray(value)) {
      const array = JSONArray.create(ticket);
      target.set(key, array);
      context.registerElement(array);
      context.push(SetOperation.create(key, array.deepcopy(), target.getCreatedAt(), ticket));
      for (const element of value) {
        ArrayProxy.pushInternal(context, array, element)
      }
    } else if (typeof value === 'object') {
      if (value instanceof PlainText) {
        target.set(key, value);
        context.registerElement(value);
        context.push(SetOperation.create(key, value.deepcopy(), target.getCreatedAt(), ticket));
      } else {
        const obj = JSONObject.create(ticket);
        target.set(key, obj);
        context.registerElement(obj);
        context.push(SetOperation.create(key, obj.deepcopy(), target.getCreatedAt(), ticket));
        for (const [k, v] of Object.entries(value)) {
          ObjectProxy.setInternal(context, obj, k, v);
        }
      }
    } else {
      logger.fatal(`unsupported type of value: ${typeof value}`);
    }
  }

  public static createText(context: ChangeContext, target: JSONObject, key: string): PlainText {
    const ticket = context.issueTimeTicket();
    const text = PlainText.create(RGATreeSplit.create(), ticket);
    target.set(key, text);
    context.registerElement(text);
    context.push(SetOperation.create(key, text.deepcopy(), target.getCreatedAt(), ticket));
    return TextProxy.create(context, text);
  }

  public static createRichText(context: ChangeContext, target: JSONObject, key: string): RichText {
    const ticket = context.issueTimeTicket();
    const text = RichText.create(RGATreeSplit.create(), ticket);
    target.set(key, text);
    context.registerElement(text);
    context.push(SetOperation.create(key, text.deepcopy(), target.getCreatedAt(), ticket));
    return RichTextProxy.create(context, text);
  }

  public static deleteInternal(context: ChangeContext, target: JSONObject, key: string): void {
    const ticket = context.issueTimeTicket();
    const deleted = target.deleteByKey(key, ticket);
    context.push(RemoveOperation.create(target.getCreatedAt(), deleted.getCreatedAt(), ticket));
  }

  public getHandlers(): any {
    return this.handlers;
  }
}
